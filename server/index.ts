import 'dotenv/config';
import { createApp } from './app.js';
import { createAIAsk } from './ai.js';
import { codexIsAvailable, codexSettings, createCodexAsk } from './codex-provider.js';
import { cameraBridge } from './camera.js';
import { createConfiguredLearningProvider } from './learning-provider-selection.js';

const port = Number(process.env.PORT ?? 3001);
const provider = process.env.GENIE_AI_PROVIDER ?? 'codex';
if (provider !== 'codex' && provider !== 'openai') throw new Error('GENIE_AI_PROVIDER must be codex or openai.');
const codexReady = provider === 'codex' && codexIsAvailable();
const ai = codexReady ? createCodexAsk() : provider === 'openai' ? createAIAsk() : undefined;
const tutor = provider === 'codex' ? codexSettings('tutor') : undefined;
const model = tutor ? `${tutor.model} · ${tutor.reasoningEffort} · Codex` : (process.env.OPENAI_MODEL || 'gpt-5.4');
const learningProvider = createConfiguredLearningProvider(process.env.GENIE_DB_PATH || '.local/genie.sqlite');
const app = createApp({ ai, aiConfigured: Boolean(ai), model, learningProvider, learningConfigured: Boolean(learningProvider) });
const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`ARI API listening on http://127.0.0.1:${port}\n`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  app.locals.learning.stop();
  cameraBridge.stop();
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
  server.close(() => process.exit(0));
});
