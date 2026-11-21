import { resolve, join } from 'node:path';
import { createLearningProvider, type LearningAgentProvider } from './learning-provider.js';
import { createCodexLearningProvider } from './codex-learning-provider.js';
import { createClaudeLearningProvider } from './claude-learning-provider.js';
import { learningTools } from './learning-service.js';

const providers = ['codex', 'openai', 'claude'] as const;

export function mainProviderSettings(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.ARI_MAIN_PROVIDER || 'codex';
  if (!(providers as readonly string[]).includes(provider)) throw new Error('ARI_MAIN_PROVIDER must be codex, openai, or claude.');
  const models = { codex: env.CODEX_MAIN_MODEL || 'gpt-6-astra', openai: env.OPENAI_MAIN_MODEL || 'gpt-6-astra', claude: env.CLAUDE_MAIN_MODEL || 'claude-opus-5-5' };
  return { provider, model: models[provider as keyof typeof models] };
}

export function createConfiguredLearningProvider(dbPath: string): LearningAgentProvider | undefined {
  const settings = mainProviderSettings();
  if (settings.provider === 'openai') return createLearningProvider();
  if (settings.provider === 'claude') return createClaudeLearningProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: settings.model });
  const runtime = resolve(`${dbPath}.codex`);
  return createCodexLearningProvider({ model: settings.model, cwd: join(runtime, 'workspace'), stateDir: join(runtime, 'state'), tools: learningTools });
}
