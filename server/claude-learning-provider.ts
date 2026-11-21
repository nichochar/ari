import Anthropic from '@anthropic-ai/sdk';
import type { ModelOption, ReasoningEffort } from '../shared/model-settings.js';
import { estimateTokens, LearningProviderError, type LearningAgentProvider, type LearningAgentRequest } from './learning-provider.js';

type Item = Record<string, unknown>;
type Block = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
type Client = Pick<Anthropic, 'messages' | 'models'>;

const TOOL_ROUNDS = 12;
const MAX_TOKENS = 12_000;
const efforts: ReasoningEffort[] = ['low', 'medium', 'high'];
const catalog: ModelOption[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts, defaultEffort: 'high' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', efforts, defaultEffort: 'medium' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', efforts, defaultEffort: 'medium' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', efforts, defaultEffort: 'high' },
];

const item = (value: unknown): Item => value && typeof value === 'object' ? value as Item : {};

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const inline = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/s.exec(url);
  return inline
    ? { type: 'image', source: { type: 'base64', media_type: inline[1] as 'image/png', data: inline[2] } }
    : { type: 'image', source: { type: 'url', url } };
}

/** Converts stored Responses-style content into Claude text and image blocks. */
function contentBlocks(content: unknown): Block[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): Block[] => {
    const entry = item(part);
    if (['input_text', 'output_text', 'text'].includes(String(entry.type)) && typeof entry.text === 'string')
      return entry.text ? [{ type: 'text', text: entry.text }] : [];
    if (entry.type === 'input_image' && typeof entry.image_url === 'string') return [imageBlock(entry.image_url)];
    return [];
  });
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Saved Responses items become Claude messages. Items Claude cannot replay are skipped. */
export function toClaudeMessages(context: unknown[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content = [...(last.content as Anthropic.ContentBlockParam[]), ...blocks];
    else messages.push({ role, content: blocks });
  };
  for (const value of context) {
    const entry = item(value);
    if (entry.type === 'function_call' && typeof entry.call_id === 'string' && typeof entry.name === 'string') {
      push('assistant', [{ type: 'tool_use', id: entry.call_id, name: entry.name, input: parseArguments(entry.arguments) }]);
    } else if (entry.type === 'function_call_output' && typeof entry.call_id === 'string') {
      const blocks = contentBlocks(entry.output);
      push('user', [{ type: 'tool_result', tool_use_id: entry.call_id, content: blocks.length ? blocks : 'null' }]);
    } else if (entry.role === 'user' || entry.role === 'assistant') {
      push(entry.role, contentBlocks(entry.content));
    }
  }
  return messages;
}

function toolOutput(result: unknown): unknown {
  const value = item(result);
  if (value.type !== 'image_result' || !Array.isArray(value.images)) return JSON.stringify(result ?? null);
  return [{ type: 'input_text', text: String(value.text ?? '') },
    ...value.images.slice(0, 3).map(image => ({ type: 'input_image', image_url: String(image) }))];
}

function withoutSchemaMarkers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSchemaMarkers);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema')
    .map(([key, child]) => [key, withoutSchemaMarkers(child)]));
}

/** Claude returns text and tool calls; saved history keeps them as Responses-style items. */
function savedItems(message: Anthropic.Message): { items: Item[]; text: string } {
  const texts: string[] = [];
  const calls: Item[] = [];
  for (const block of message.content) {
    if (block.type === 'text') texts.push(block.text);
    if (block.type === 'tool_use') calls.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
  }
  const text = texts.join('\n\n');
  const items: Item[] = text ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] : [];
  return { items: [...items, ...calls], text };
}

const stripFences = (text: string) => text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

function claudeProviderError(error: unknown): LearningProviderError {
  if (error instanceof LearningProviderError) return error;
  const e = error as { status?: number; name?: string; message?: string };
  if (/credit balance/i.test(e?.message ?? ''))
    return new LearningProviderError('API_CREDITS', 'Anthropic API credits are exhausted. Add credits, then retry this message.');
  if (e?.status === 401 || e?.status === 403)
    return new LearningProviderError('API_AUTH', 'The Anthropic API connection is not authorized. Check the server API key.');
  if (e?.status === 429 || e?.status === 529)
    return new LearningProviderError('API_RATE_LIMIT', 'Claude is busy right now. Retry shortly.');
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'AbortError')
    return new LearningProviderError('API_TIMEOUT', 'Ari took too long to respond. Your message is saved; retry to continue.');
  return new LearningProviderError('API_FAILED', 'Ari could not finish this response. Your message is saved; retry to continue.');
}

/** Claude Messages API provider. Context is kept in the same item shape as the OpenAI provider. */
export function createClaudeLearningProvider(options: { apiKey?: string; client?: Client; model?: string; reasoningEffort?: ReasoningEffort } = {}): LearningAgentProvider | undefined {
  const client = options.client ?? (options.apiKey ? new Anthropic({ apiKey: options.apiKey, timeout: 180_000, maxRetries: 0 }) : undefined);
  if (!client) return undefined;
  const model = options.model ?? (process.env.CLAUDE_MAIN_MODEL || 'claude-opus-5-5');
  const effort = options.reasoningEffort ?? 'high';

  const send = async (params: Anthropic.MessageCreateParamsNonStreaming, onText?: (delta: string) => void | Promise<void>) => {
    let chain = Promise.resolve();
    const stream = client.messages.stream(params).on('text', text => { chain = chain.then(() => onText?.(text)); });
    const message = await stream.finalMessage();
    await chain;
    return message;
  };
  const systemPrompt = (instructions: string, outputSchema?: Record<string, unknown>) => outputSchema
    ? `${instructions}\n\nReturn only one JSON object that matches this JSON Schema, with no text outside it:\n${JSON.stringify(outputSchema)}`
    : instructions;

  return {
    model: `${model} · ${effort}`,
    async listModels() {
      const available = new Set<string>();
      for await (const entry of client.models.list()) available.add(entry.id);
      return catalog.filter(option => available.has(option.id));
    },
    async run(request) {
      const context = structuredClone(request.input) as unknown[];
      const start = context.length;
      const tools = new Map(request.tools.map(tool => [tool.name, tool]));
      const texts: string[] = request.resumeText ? [request.resumeText] : [];
      let inputTokens = estimateTokens(context);
      const checkpoint = () => request.onCheckpoint?.(structuredClone(context), inputTokens, texts.join('\n\n'));
      const runToolCall = async (call: Item): Promise<unknown> => {
        if (typeof call.name !== 'string' || !tools.has(call.name)) return { error: 'This tool is unavailable. Use a listed tool.' };
        let args: unknown;
        try { args = JSON.parse(String(call.arguments)); } catch { return { error: 'Tool arguments must be valid JSON.' }; }
        return request.executeTool(call.name, args, String(call.call_id));
      };
      const answerPendingCalls = async () => {
        const answered = new Set(context.map(item).filter(value => value.type === 'function_call_output').map(value => value.call_id));
        for (const call of context.map(item)) {
          if (call.type !== 'function_call' || typeof call.call_id !== 'string' || answered.has(call.call_id)) continue;
          const output = { type: 'function_call_output', call_id: call.call_id, output: toolOutput(await runToolCall(call)) };
          context.push(output);
          answered.add(call.call_id);
          inputTokens += estimateTokens([output]);
          await checkpoint();
        }
      };
      try {
        if (request.resumeText) await request.onText?.(request.resumeText + '\n\n');
        await answerPendingCalls();
        for (let round = 0; round < TOOL_ROUNDS; round++) {
          const instructions = await request.refreshInstructions?.() ?? request.instructions;
          const message = await send({
            model, max_tokens: MAX_TOKENS, system: systemPrompt(instructions, request.outputSchema),
            messages: toClaudeMessages(context),
            tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: withoutSchemaMarkers(tool.parameters) as Anthropic.Tool['input_schema'] })),
            tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          }, request.onText);
          if (message.stop_reason === 'max_tokens')
            throw new LearningProviderError('API_INCOMPLETE', 'Ari reached the response length limit. Retry to continue.');
          const { items, text } = savedItems(message);
          context.push(...items);
          inputTokens = message.usage.input_tokens + message.usage.output_tokens;
          if (text) texts.push(text);
          await checkpoint();
          if (!items.some(value => value.type === 'function_call')) {
            const finalText = request.outputSchema ? stripFences(text) : texts.join('\n\n');
            return { output: context.slice(start), text: finalText, inputTokens, context };
          }
          await answerPendingCalls();
        }
        throw new LearningProviderError('TOOL_LIMIT', 'Ari reached the tool limit for this turn. Retry to continue from the saved work.');
      } catch (error) { throw claudeProviderError(error); }
    },
    async compact(input, instructions) {
      try {
        const request = [...input, { role: 'user', content: [{ type: 'input_text', text: 'Summarize the conversation above so Ari can continue it. Keep learner goals, progress, open questions, and decisions.' }] }];
        const message = await client.messages.create({ model, max_tokens: MAX_TOKENS, system: instructions, messages: toClaudeMessages(request) });
        const { text } = savedItems(message);
        if (!text) throw new LearningProviderError('COMPACTION_FAILED', 'Ari could not compact this conversation. Its full history is still saved.');
        return [{ role: 'user', content: [{ type: 'input_text', text: `Earlier conversation summary:\n${text}` }] }];
      } catch (error) { throw claudeProviderError(error); }
    },
    async generate<T>(instructions: string, payload: unknown, schema: Record<string, unknown>): Promise<T> {
      try {
        const message = await client.messages.create({
          model, max_tokens: 16_000, system: systemPrompt(instructions, schema),
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
        });
        const { text } = savedItems(message);
        if (message.stop_reason !== 'end_turn' || !text)
          throw new LearningProviderError('API_INCOMPLETE', 'Ari could not finish preparing this content. Retry to continue.');
        return JSON.parse(stripFences(text)) as T;
      } catch (error) { throw claudeProviderError(error); }
    },
  };
}
