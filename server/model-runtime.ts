import { join, resolve } from 'node:path';
import type { StateStore } from './state.js';
import { defaultModelSelection, type ModelOption, type ModelSelection, type ModelSettingsView } from '../shared/model-settings.js';
import { modelSelectionSchema } from './model-settings-schema.js';
import { createCodexLearningProvider } from './codex-learning-provider.js';
import { createLearningProvider, LearningProviderError, type LearningAgentProvider } from './learning-provider.js';
import { learningTools } from './learning-service.js';
import { workspaceTools } from './personalization-tools.js';
import { aiSchemas, type AIAsk } from './ai.js';

export function switchingProvider(selection: () => ModelSelection,
  factory: (selection: ModelSelection) => LearningAgentProvider): LearningAgentProvider {
  type Entry = { key: string; provider: LearningAgentProvider; active: number };
  let current: Entry | undefined;
  const entries = new Set<Entry>();
  const release = (entry: Entry) => {
    if (entry !== current && entry.active === 0) { entry.provider.close?.(); entries.delete(entry); }
  };
  const resolveProvider = () => {
    const selected = selection(), key = JSON.stringify(selected);
    if (current?.key !== key) {
      const previous = current;
      current = { key, provider: factory(selected), active: 0 }; entries.add(current);
      if (previous) release(previous);
    }
    return current;
  };
  const use = async <T>(work: (provider: LearningAgentProvider) => Promise<T>) => {
    const entry = resolveProvider(); entry.active++;
    try { return await work(entry.provider); }
    finally { entry.active--; release(entry); }
  };
  return {
    get model() { return resolveProvider().provider.model; },
    get managesCompaction() { return resolveProvider().provider.managesCompaction; },
    contextTokens: context => resolveProvider().provider.contextTokens?.(context),
    listModels: () => use(p => p.listModels?.() ?? Promise.resolve([])),
    run: request => use(p => p.run(request)),
    compact: (input, instructions) => use(p => p.compact(input, instructions)),
    generate: <T>(instructions: string, payload: unknown, schema: Record<string, unknown>) => use(p => p.generate<T>(instructions, payload, schema)),
    close() { for (const entry of entries) entry.provider.close?.(); entries.clear(); current = undefined; },
  };
}

export class ModelSettingsService {
  constructor(private store: StateStore, private defaults: ModelSelection, private catalog: () => Promise<ModelOption[]>) {}
  selection = (): ModelSelection => this.store.readModelSelection() ?? { ...this.defaults };
  async view(): Promise<ModelSettingsView> { return { selection: this.selection(), models: await this.catalog() }; }
  async save(raw: unknown): Promise<ModelSettingsView> {
    const selection = modelSelectionSchema.parse(raw);
    const models = await this.catalog();
    const model = models.find(option => option.id === selection.model);
    if (!model || !model.efforts.includes(selection.reasoningEffort))
      throw new LearningProviderError('MODEL_SELECTION', 'Choose an available model and one of its supported reasoning efforts.');
    this.store.saveModelSelection(selection);
    return { selection, models };
  }
}

export interface ModelRuntime {
  settings: ModelSettingsService;
  learningProvider?: LearningAgentProvider;
  personalizationProvider?: LearningAgentProvider;
  ai?: AIAsk;
  close(): void;
}

export function createModelRuntime(store: StateStore, dbPath: string, env: NodeJS.ProcessEnv = process.env): ModelRuntime {
  const mainConnection = env.ARI_MAIN_PROVIDER || 'codex', tutorConnection = env.ARI_AI_PROVIDER || 'codex';
  if (![mainConnection, tutorConnection].every(p => p === 'codex' || p === 'openai'))
    throw new Error('Ari providers must be codex or openai.');
  const defaults = modelSelectionSchema.parse({
    model: (mainConnection === 'codex' ? env.CODEX_MAIN_MODEL || env.CODEX_TUTOR_MODEL : env.OPENAI_MAIN_MODEL || env.OPENAI_MODEL) || defaultModelSelection.model,
    reasoningEffort: env.ARI_REASONING_EFFORT || defaultModelSelection.reasoningEffort,
  });
  const runtime = resolve(`${dbPath}.codex`);
  const selection = (): ModelSelection => settings.selection();
  const make = (connection: string, tools: typeof learningTools): LearningAgentProvider | undefined => connection === 'openai' && !env.OPENAI_API_KEY ? undefined : switchingProvider(selection, selected => {
    if (connection === 'openai') return createLearningProvider(env.OPENAI_API_KEY, undefined, selected)!;
    return createCodexLearningProvider({ ...selected, cwd: join(runtime, 'workspace'), stateDir: join(runtime, 'state'), tools });
  });
  const learningProvider = make(mainConnection, learningTools);
  const personalizationProvider = make(tutorConnection, workspaceTools);
  const settings = new ModelSettingsService(store, defaults, async () => {
    if (!learningProvider || !personalizationProvider) throw new LearningProviderError('MODEL_CONNECTION', 'Connect the configured tutors before choosing a model.');
    const main = await learningProvider.listModels!();
    const tutor = mainConnection === tutorConnection ? main : await personalizationProvider.listModels!();
    return main.flatMap(model => {
      const efforts = model.efforts.filter(effort => tutor.find(m => m.id === model.id)?.efforts.includes(effort));
      return efforts.length ? [{ ...model, efforts, defaultEffort: efforts.includes(model.defaultEffort) ? model.defaultEffort : efforts[0] }] : [];
    });
  });
  let active = 0;
  const ai: AIAsk | undefined = personalizationProvider ? async (task, instructions, payload, image) => {
    if (active >= 2) throw new Error('AI_BUSY');
    active++;
    try {
      const content: unknown[] = [{ type: 'input_text', text: JSON.stringify(payload) }];
      for (const url of typeof image === 'string' ? [image] : image ?? []) content.push({ type: 'input_image', image_url: url, detail: 'high' });
      const result = await personalizationProvider.run({ instructions, input: [{ role: 'user', content }], tools: [], ephemeral: true,
        outputSchema: aiSchemas[task], executeTool: async () => ({ error: 'Tools are unavailable for this request.' }) });
      return JSON.parse(result.text);
    } finally { active--; }
  } : undefined;
  return { settings, learningProvider, personalizationProvider, ai,
    close() { learningProvider?.close?.(); personalizationProvider?.close?.(); } };
}
