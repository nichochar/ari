import { resolve, join } from 'node:path';
import { createLearningProvider, type LearningAgentProvider } from './learning-provider.js';
import { createCodexLearningProvider } from './codex-learning-provider.js';
import { learningTools } from './learning-service.js';

export function mainProviderSettings(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.ARI_MAIN_PROVIDER || 'codex';
  if (provider !== 'codex' && provider !== 'openai') throw new Error('ARI_MAIN_PROVIDER must be codex or openai.');
  return { provider, model: provider === 'codex' ? (env.CODEX_MAIN_MODEL || 'gpt-6-astra') : (env.OPENAI_MAIN_MODEL || 'gpt-6-astra') };
}

export function createConfiguredLearningProvider(dbPath: string): LearningAgentProvider | undefined {
  const settings = mainProviderSettings();
  if (settings.provider === 'openai') return createLearningProvider();
  const runtime = resolve(`${dbPath}.codex`);
  return createCodexLearningProvider({ model: settings.model, cwd: join(runtime, 'workspace'), stateDir: join(runtime, 'state'), tools: learningTools });
}
