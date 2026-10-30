import 'dotenv/config';
import { createApp } from './app.js';
import { cameraBridge } from './camera.js';
import { createModelRuntime } from './model-runtime.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp({ runtimeFactory: store => createModelRuntime(store, process.env.ARI_DB_PATH || '.local/ari.sqlite') });
const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Ari API listening on http://127.0.0.1:${port}\n`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  app.locals.learning.stop();
  app.locals.assessments.stop();
  cameraBridge.stop();
  app.locals.modelRuntime.close();
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
  server.close(() => process.exit(0));
});
