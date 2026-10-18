import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { mainChatRequestSchema, memoryPatchSchema } from './learning-schema.js';
import { MaterialError } from './learning-materials.js';
import { LearningError, LearningService } from './learning-service.js';

const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();
const emptySchema = z.object({}).strict();
export function learningRoutes(service: LearningService) {
  const router = Router();
  router.get('/', async (_req, res) => res.json(await service.view()));
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const changed = () => { if (!res.destroyed) res.write('event: change\ndata: {}\n\n'); };
    changed(); service.events.on('change', changed);
    // This is connection maintenance only; it does not run learner check-ins.
    const keepalive = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 25000);
    keepalive.unref();
    req.on('close', () => { clearInterval(keepalive); service.events.off('change', changed); });
  });
  router.post('/chat', async (req, res) => res.status(202).json(await service.chat(mainChatRequestSchema.parse(req.body))));
  router.post('/proposals/:id/accept', async (req, res) => res.status(202).json(await service.accept(String(req.params.id), revisionSchema.parse(req.body).revision)));
  router.post('/proposals/:id/dismiss', async (req, res) => res.json(await service.dismiss(String(req.params.id), revisionSchema.parse(req.body).revision)));
  router.post('/lessons/:id/prepare', async (req, res) => { emptySchema.parse(req.body); res.status(202).json(await service.prepare(String(req.params.id))); });
  router.patch('/memory', async (req, res) => { const input = memoryPatchSchema.parse(req.body); res.json(await service.memory(input.content, input.revision, 'user')); });
  router.get('/materials/:id/source', async (req, res) => {
    const material = (await service.store.readLearning()).materials.find(m => m.id === req.params.id);
    if (!material) throw new LearningError(404, 'Material not found.');
    res.setHeader('Cache-Control', 'private, no-store');
    if (material.kind === 'pdf' && material.sourceData) { res.setHeader('Content-Disposition', 'attachment; filename="material.pdf"'); res.type('application/pdf').send(Buffer.from(material.sourceData.split(',')[1], 'base64')); }
    else res.type('text/plain').send(material.text);
  });
  router.post('/materials', async (req, res) => res.status(201).json(await service.material(req.body)));
  router.post('/read', async (req, res) => { emptySchema.parse(req.body); res.json(await service.read()); });
  router.post('/idle', async (req, res) => { emptySchema.parse(req.body); res.json(await service.idle()); });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof MaterialError) return res.status(400).json({ error: error.message });
    if (error instanceof LearningError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid learning request.' });
    next(error);
  });
  return router;
}
