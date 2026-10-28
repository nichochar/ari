import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AssessmentError, AssessmentService } from './assessment-service.js';

const empty = z.object({}).strict();
export function assessmentRoutes(service: AssessmentService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.get('/', async (_req, res) => res.json(await service.list()));
  router.post('/', async (req, res) => res.status(202).json(await service.create(req.body)));
  router.get('/:id', async (req, res) => res.json(await service.view(String(req.params.id))));
  router.patch('/:id', async (req, res) => res.json(await service.patch(String(req.params.id), req.body)));
  router.post('/:id/prepare', async (req, res) => { empty.parse(req.body); res.status(202).json(await service.prepare(String(req.params.id))); });
  router.post('/:id/retry', async (req, res) => { empty.parse(req.body); res.status(202).json(await service.retry(String(req.params.id))); });
  router.post('/:id/pause', async (req, res) => { empty.parse(req.body); res.json(await service.pause(String(req.params.id))); });
  router.post('/:id/resume', async (req, res) => { empty.parse(req.body); res.json(await service.resume(String(req.params.id))); });
  router.post('/:id/pages', async (req, res) => res.status(201).json(await service.addPage(String(req.params.id), req.body)));
  router.delete('/:id/pages/:pageId', async (req, res) => res.json(await service.removePage(String(req.params.id), String(req.params.pageId))));
  router.post('/:id/chat', async (req, res) => res.status(202).json(await service.chat(String(req.params.id), req.body)));
  router.post('/:id/messages/:messageId/retry', async (req, res) => { empty.parse(req.body); res.status(202).json(await service.retryChat(String(req.params.id), String(req.params.messageId))); });
  router.post('/:id/submit', async (req, res) => res.status(202).json(await service.submit(String(req.params.id), req.body)));
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof AssessmentError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid assessment request.' });
    next(error);
  });
  return router;
}
