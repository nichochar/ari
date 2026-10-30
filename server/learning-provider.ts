import OpenAI from 'openai';
import type { Response, ResponseInputItem, Tool } from 'openai/resources/responses/responses';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ModelOption, ReasoningEffort } from '../shared/model-settings.js';
import type { ReasoningEffort as APIReasoningEffort } from 'openai/resources/shared';

export interface LearningTool {
  type: 'function'; name: string; description: string;
  parameters: Record<string, unknown>; strict?: boolean;
}
export interface LearningAgentRequest {
  instructions: string; input: unknown[]; tools: LearningTool[];
  refreshInstructions?: () => Promise<string>;
  /** A structured final answer may still be preceded by tool calls. */
  outputSchema?: Record<string, unknown>;
  ephemeral?: boolean;
  /** Stable app run identity for provider-owned conversation recovery. */
  runKey?: string;
  /** Completed text from this turn, retained even when compaction folds it away. */
  resumeText?: string;
  executeTool: (name: string, args: unknown, callId: string) => Promise<unknown>;
  onText?: (delta: string) => void | Promise<void>;
  onCompaction?: (event: { status: 'started' | 'completed'; id?: string }) => void | Promise<void>;
  /** Full canonical input window, including completed outputs and tool results. */
  onCheckpoint?: (context: unknown[], inputTokens: number, completedText?: string) => void | Promise<void>;
}
export interface LearningAgentProvider {
  model: string;
  managesCompaction?: boolean;
  listModels?(): Promise<ModelOption[]>;
  close?(): void;
  /** Actual context size when the provider owns an opaque conversation window. */
  contextTokens?(context: unknown[]): number | undefined;
  run(request: LearningAgentRequest): Promise<{ output: unknown[]; text: string; inputTokens: number; context?: unknown[] }>;
  compact(input: unknown[], instructions: string): Promise<unknown[]>;
  generate<T>(instructions: string, payload: unknown, schema: Record<string, unknown>): Promise<T>;
}

export class LearningProviderError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function learningProviderError(error: unknown): LearningProviderError {
  if (error instanceof LearningProviderError) return error;
  const e = error as { status?: number; code?: string; name?: string; error?: { code?: string } };
  if (['credit_balance_exhausted', 'insufficient_quota'].includes(e?.code ?? e?.error?.code ?? ''))
    return new LearningProviderError('API_CREDITS', 'OpenAI API credits are exhausted. Add credits, then retry this message.');
  if (e?.status === 401 || e?.status === 403)
    return new LearningProviderError('API_AUTH', 'The OpenAI API connection is not authorized. Check the server API key.');
  if (e?.status === 429) return new LearningProviderError('API_RATE_LIMIT', 'Ari is temporarily rate limited. Retry shortly.');
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'AbortError')
    return new LearningProviderError('API_TIMEOUT', 'Ari took too long to respond. Your message is saved; retry to continue.');
  return new LearningProviderError('API_FAILED', 'Ari could not finish this response. Your message is saved; retry to continue.');
}

type Item = Record<string, unknown>;
const item = (value: unknown): Item => value && typeof value === 'object' ? value as Item : {};
const estimateValue = (value: unknown): number => {
  if (typeof value === 'string') return value.startsWith('data:image/') ? 5000 : Math.ceil(value.length / 3);
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + estimateValue(child), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((sum, [key, child]) => sum + (key === 'encrypted_content' ? 0 : estimateValue(child)) + 4, 0);
  return 1;
};
const estimateTokens = (context: unknown[]) => estimateValue(context);
export const learningCompactionThreshold = () => {
  const value = Number(process.env.LEARNING_COMPACTION_TOKENS ?? 64000);
  return Number.isFinite(value) && value >= 2000 && value <= 200000 ? Math.floor(value) : 64000;
};
const supportedFormats = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== 'object') return value;
  // Zod's URI format is useful for local validation, but is outside the API's
  // strict-format subset. Server validation still enforces every constraint.
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => key !== '$schema' &&
    !(key === 'format' && typeof child === 'string' && !supportedFormats.has(child)))
    .map(([key, child]) => [key, providerSchema(child)]));
}

function responseText(response: Response): string {
  const texts: string[] = [];
  const sources = new Map<string, string>();
  for (const output of response.output) {
    if (output.type !== 'message') continue;
    for (const part of output.content) {
      if (part.type === 'refusal') { texts.push(part.refusal); continue; }
      if (part.type !== 'output_text') continue;
      texts.push(part.text);
      for (const annotation of part.annotations) {
        if (annotation.type !== 'url_citation') continue;
        try {
          const url = new URL(annotation.url);
          if (url.protocol === 'https:' || url.protocol === 'http:')
            sources.set(url.href, annotation.title.replace(/[\[\]\n]/g, ' ').trim() || url.hostname);
        } catch { /* Ignore invalid URLs, never render unsafe model links. */ }
      }
    }
  }
  const text = texts.join('\n\n');
  const links = [...sources].filter(([url]) => !text.includes(url)).map(([url, title]) => `[${title}](${url.replace(/\)/g, '%29')})`);
  return links.length ? `${text}\n\nSources: ${links.join(' · ')}` : text;
}

/** Structured output belongs to the final assistant message, not earlier commentary. */
function structuredResponseText(output: unknown[]): string {
  const message = output.map(item).reverse().find(value => value.type === 'message' && value.role === 'assistant');
  if (typeof message?.content === 'string') return message.content;
  return Array.isArray(message?.content) ? message.content.map(item)
    .filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
}

/** Stateless Responses with durable input items; no implicit model/provider fallback. */
export function createLearningProvider(apiKey = process.env.OPENAI_API_KEY,
  client = apiKey ? new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 }) : undefined,
  options: { model?: string; reasoningEffort?: ReasoningEffort } = {}): LearningAgentProvider | undefined {
  if (!apiKey || !client) return undefined;
  const model = options.model ?? (process.env.OPENAI_MAIN_MODEL || 'gpt-6-astra');
  const effort = (options.reasoningEffort ?? 'high') as APIReasoningEffort;
  return {
    model: `${model} · ${effort}`,
    async listModels() {
      const available = new Set<string>();
      for await (const model of client.models.list()) available.add(model.id);
      const catalog: ModelOption[] = [
        { id: 'gpt-6-astra', name: 'GPT-6 Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
        { id: 'gpt-6-luna', name: 'GPT-6 Luna', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
        { id: 'gpt-5.4', name: 'GPT-5.4', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
        { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
      ];
      return catalog.filter(model => available.has(model.id));
    },
    async run(request) {
      const context = structuredClone(request.input);
      const start = context.length;
      let inputTokens = estimateTokens(context);
      let lastUser = -1;
      for (let index = context.length - 1; index >= 0; index--) {
        if (item(context[index]).role === 'user') { lastUser = index; break; }
      }
      const previousText = request.resumeText ?? responseText({ output: context.slice(lastUser + 1) } as Response);
      const texts: string[] = previousText ? [previousText] : [];
      const tools = new Map(request.tools.map(tool => [tool.name, tool]));
      const checkpoint = async () => request.onCheckpoint?.(structuredClone(context), inputTokens, texts.join('\n\n'));
      const finishPendingCalls = async () => {
        const outputs = new Set(context.filter(value => item(value).type === 'function_call_output').map(value => item(value).call_id));
        for (const value of [...context]) {
          const call = item(value);
          if (call.type !== 'function_call' || typeof call.call_id !== 'string' || outputs.has(call.call_id)) continue;
          let result: unknown;
          if (typeof call.name !== 'string' || !tools.has(call.name)) {
            result = { error: 'This tool is unavailable. Use a listed tool.' };
          } else {
            let args: unknown;
            try { args = JSON.parse(String(call.arguments)); }
            catch { args = undefined; }
            if (args === undefined) result = { error: 'Tool arguments must be valid JSON.' };
            else result = await request.executeTool(call.name, args, call.call_id);
          }
          const imageResult = item(result);
          const output = imageResult.type === 'image_result' && Array.isArray(imageResult.images)
            ? [{ type: 'input_text', text: String(imageResult.text ?? '') },
              ...imageResult.images.slice(0, 3).map(image => ({ type: 'input_image', image_url: String(image), detail: 'high' }))]
            : JSON.stringify(result ?? null);
          const outputItem = { type: 'function_call_output', call_id: call.call_id, output };
          context.push(outputItem);
          outputs.add(call.call_id);
          inputTokens += estimateValue(outputItem);
          await checkpoint();
        }
      };
      try {
        if (previousText) await request.onText?.(previousText + '\n\n');
        // A complete final response can be checkpointed just before a process
        // exits. Reuse it instead of asking the model to answer the turn twice.
        const last = item(context.at(-1));
        const completedCalls = new Set(context.filter(value => item(value).type === 'function_call_output').map(value => item(value).call_id));
        const hasPendingCall = context.some(value => item(value).type === 'function_call' && !completedCalls.has(item(value).call_id));
        if (!hasPendingCall && previousText && last.type === 'message' && last.role === 'assistant' && last.status === 'completed')
          return { output: [], text: request.outputSchema ? structuredResponseText(context) : previousText, inputTokens, context };
        // A server restart may have happened after saving a model tool call.
        // The application replays its saved result by call_id, making this safe.
        await finishPendingCalls();
        for (let round = 0; round < 12; round++) {
          const instructions = await request.refreshInstructions?.() ?? request.instructions;
          if (round > 0 && texts.length) await request.onText?.('\n\n');
          if (inputTokens >= learningCompactionThreshold()) {
            await request.onCompaction?.({ status: 'started' });
            const compacted = await client.responses.compact({ model, input: context as ResponseInputItem[], instructions });
            if (!compacted.output.some(output => output.type === 'compaction'))
              throw new LearningProviderError('COMPACTION_FAILED', 'Ari could not compact this conversation. Its full history is still saved.');
            context.splice(0, context.length, ...compacted.output);
            inputTokens = estimateTokens(context);
            await checkpoint();
            await request.onCompaction?.({ status: 'completed' });
          }
          const stream = await client.responses.create({
            model, reasoning: { effort }, instructions,
            input: context as ResponseInputItem[], store: false, stream: true,
            include: ['reasoning.encrypted_content'], max_output_tokens: 12_000,
            tools: [...request.tools.map(tool => ({ ...tool, parameters: providerSchema(tool.parameters) })), { type: 'web_search' }] as Tool[],
            parallel_tool_calls: false,
            ...(request.outputSchema ? { text: { format: { type: 'json_schema' as const, name: 'ari_tutor', strict: true,
              schema: providerSchema(request.outputSchema) as Record<string, unknown> } } } : {}),
          });
          let response: Response | undefined;
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') await request.onText?.(event.delta);
            if (event.type === 'response.completed') response = event.response;
            if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error')
              throw new LearningProviderError('API_INCOMPLETE', 'Ari did not finish this response. Retry to continue.');
          }
          if (!response || response.status !== 'completed')
            throw new LearningProviderError('API_INCOMPLETE', 'The response was interrupted. Retry to continue.');
          context.push(...toResponseInputItems(response.output));
          inputTokens = response.usage ? response.usage.input_tokens + response.usage.output_tokens : estimateTokens(context);
          const text = responseText(response);
          if (text) texts.push(text);
          // Save completed response items before any tool can change app state.
          await checkpoint();
          if (!response.output.some(output => output.type === 'function_call'))
            return { output: context.slice(start), text: request.outputSchema ? structuredResponseText(response.output) : texts.join('\n\n'), inputTokens, context };
          await finishPendingCalls();
        }
        throw new LearningProviderError('TOOL_LIMIT', 'Ari reached the tool limit for this turn. Retry to continue from the saved work.');
      } catch (error) { throw learningProviderError(error); }
    },
    async compact(input, instructions) {
      try {
        const result = await client.responses.compact({ model, input: input as ResponseInputItem[], instructions });
        if (!result.output.some(output => output.type === 'compaction'))
          throw new LearningProviderError('COMPACTION_FAILED', 'Ari could not compact this conversation. Its full history is still saved.');
        // Standalone compact output is canonical: keep retained messages too.
        return result.output;
      } catch (error) { throw learningProviderError(error); }
    },
    async generate<T>(instructions: string, payload: unknown, schema: Record<string, unknown>): Promise<T> {
      try {
        const response = await client.responses.create({
          model, reasoning: { effort }, instructions, store: false,
          input: [{ role: 'user', content: JSON.stringify(payload) }], max_output_tokens: 16_000,
          text: { format: { type: 'json_schema', name: 'ari_learning_content', strict: true, schema: providerSchema(schema) as Record<string, unknown> } },
        });
        if (response.status !== 'completed' || !response.output_text)
          throw new LearningProviderError('API_INCOMPLETE', 'Ari could not finish preparing this content. Retry to continue.');
        return JSON.parse(response.output_text) as T;
      } catch (error) { throw learningProviderError(error); }
    },
  };
}
