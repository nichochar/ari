import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { mainChatRequestSchema, memoryPatchSchema, onboardingCompleteSchema, personalizationRestoreSchema, personalizationWriteSchema } from './learning-schema.js';
import { MaterialError } from './learning-materials.js';
import { LearningError, LearningService } from './learning-service.js';
import { PersonalizationError } from './personalization.js';

const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();
const emptySchema = z.object({}).strict();
export function learningRoutes(service: LearningService) {
  const router = Router();
  router.get('/', async (_req, res) => res.json(await service.view()));
  router.get('/personalization', async (_req, res) => { res.setHeader('Cache-Control', 'private, no-store'); res.json(await service.workspace.view()); });
  router.get('/personalization/file', async (req, res) => {
    const path = z.string().min(1).max(300).parse(req.query.path);
    const offset = z.coerce.number().int().min(0).max(64000).optional().parse(req.query.offset);
    const limit = z.coerce.number().int().min(1).max(64000).optional().parse(req.query.limit);
    res.setHeader('Cache-Control', 'private, no-store'); res.json(await service.workspace.read(path, offset, limit));
  });
  router.put('/personalization/file', async (req, res) => {
    const input = personalizationWriteSchema.parse(req.body);
    const file = await service.workspace.write(input.path, input.content, { expectedHash: input.expectedHash, actor: 'user', reason: input.reason ?? 'Edited in personalization settings' });
    await service.personalizationChanged(); res.json(file);
  });
  router.get('/personalization/history', async (req, res) => {
    const path = z.string().min(1).max(300).parse(req.query.path);
    const offset = z.coerce.number().int().min(0).max(100000).optional().parse(req.query.offset);
    const limit = z.coerce.number().int().min(1).max(100).optional().parse(req.query.limit);
    res.setHeader('Cache-Control', 'private, no-store'); res.json({ revisions: await service.workspace.revisions(path, offset, limit) });
  });
  router.post('/personalization/restore', async (req, res) => {
    const input = personalizationRestoreSchema.parse(req.body);
    const file = await service.workspace.restore(input.path, input.revision, { expectedHash: input.expectedHash, actor: 'user', reason: 'Restored historical personalization revision' });
    await service.personalizationChanged(); res.json(file);
  });
  router.get('/onboarding', async (_req, res) => res.json(await service.ensureOnboarding()));
  router.post('/onboarding/begin', async (req, res) => { emptySchema.parse(req.body); res.json(await service.beginOnboarding()); });
  router.post('/onboarding/skip', async (req, res) => { emptySchema.parse(req.body); res.json(await service.skipOnboarding()); });
  router.post('/onboarding/complete', async (req, res) => {
    const input = onboardingCompleteSchema.parse(req.body);
    if (input.goals && !input.expectedUserHash) throw new LearningError(400, 'Read the current learner document before completing setup.');
    if (!input.goals) {
      const current = await service.workspace.coreView();
      if ((input.expectedUserHash && input.expectedUserHash !== current.user.hash) || (input.expectedTutorHash && input.expectedTutorHash !== current.tutor.hash))
        throw new LearningError(409, 'Personalization changed. Review the latest files before finishing setup.');
    }
    res.json(await service.completeOnboarding(input.goals ? { ...input, goals: input.goals, expectedUserHash: input.expectedUserHash! } : undefined));
  });
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const changed = () => { if (!res.destroyed) res.write('event: change\ndata: {}\n\n'); };
    const message = (update: unknown) => {
      if (res.destroyed) return;
      if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
      res.write(`event: message\ndata: ${JSON.stringify(update)}\n\n`);
    };
    changed(); service.events.on('change', changed);
    service.events.on('message', message);
    // This is connection maintenance only; it does not run learner check-ins.
    const keepalive = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 25000);
    keepalive.unref();
    req.on('close', () => { clearInterval(keepalive); service.events.off('change', changed); service.events.off('message', message); });
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
    if (error instanceof PersonalizationError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid learning request.' });
    next(error);
  });
  return router;
}
