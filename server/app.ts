import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import { join } from 'node:path';
import { Store } from './store.js';
import { SimulationService } from './service.js';
import { PROMPT_VERSION } from '../shared/prompts.js';
import { AppError } from './errors.js';
import type { ImageProvider } from './provider.js';
import { isStageKey, MAX_UPLOAD_BYTES, STAGES, STAGE_INFO } from '../shared/domain.js';

export interface AppOptions {
  dataDir: string; provider: ImageProvider; model: string; staticDir?: string;
  origins?: string[]; timeoutMs?: number;
}
const idSchema = z.string().uuid();
const revisionSchema = z.number().int().min(0);
const paramsSchema = z.object({ id: idSchema });
const stageParams = paramsSchema.extend({ stage: z.enum(STAGES) });
const promptField = z.string().trim().min(1).max(12_000);
const promptsSchema = z.object({
  common: promptField,
  stages: z.object({ month_6: promptField, month_18: promptField, final: promptField }).strict(),
}).strict();

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: MAX_UPLOAD_BYTES * 2, requestTimeout: 60_000 });
  const store = await Store.open(options.dataDir);
  const service = new SimulationService(store, options.provider, options.model, options.timeoutMs);
  await service.auditPendingVisuals();
  const origins = new Set(options.origins ?? ['http://127.0.0.1:5173', 'http://127.0.0.1:3001']);
  const hosts = new Set([...origins].map((origin) => new URL(origin).host));
  app.addHook('onRequest', async (request) => {
    // Bind to loopback AND reject hostile Origin/Host (including DNS rebinding).
    if (!hosts.has(request.headers.host ?? '')) throw new AppError(403, 'HOST_FORBIDDEN', 'Origen de la solicitud no permitido.');
    const origin = request.headers.origin;
    if ((origin && !origins.has(origin)) || request.headers['sec-fetch-site'] === 'cross-site')
      throw new AppError(403, 'ORIGIN_FORBIDDEN', 'Esta aplicación acepta solicitudes únicamente desde su interfaz local.');
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_REQUEST', error: 'Los datos enviados no son válidos. Revisa los campos y vuelve a intentar.' });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code, error: error.message });
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) return reply.code(413).send({ code: 'FILE_TOO_LARGE', error: 'La fotografía supera el límite de 20 MB.' });
    return reply.code(500).send({ code: 'INTERNAL_ERROR', error: 'No se pudo completar la operación local. Revisa el estado antes de reintentar.' });
  });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2 } });
  app.get('/api/health', async () => ({
    ready: options.provider.ready, model: options.model, mode: options.provider.mode, promptVersion: PROMPT_VERSION,
    ...(!options.provider.ready ? { warning: `Configura ${options.provider.mode === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} en .env.local o .env y reinicia el servidor. Puedes preparar la región dental mientras tanto.` } : {}),
  }));
  app.post('/api/simulations', async (request, reply) => {
    const file = await request.file();
    if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Selecciona una fotografía JPEG o PNG.');
    const bytes = await file.toBuffer();
    const sim = await service.upload(bytes, file.filename);
    return reply.code(201).send(sim);
  });
  app.get('/api/simulations', async (request) => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return store.history(offset);
  });
  app.get('/api/simulations/:id', async (request) => service.get(paramsSchema.parse(request.params).id));
  app.put('/api/simulations/:id/prompts', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { revision, prompts } = z.object({ revision: revisionSchema, prompts: promptsSchema }).parse(request.body);
    return service.savePrompts(id, revision, prompts);
  });
  app.post('/api/simulations/:id/provider', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { revision } = z.object({ revision: revisionSchema }).parse(request.body);
    return service.selectProvider(id, revision);
  });
  app.put('/api/simulations/:id/mask', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = z.object({ revision: revisionSchema, png: z.string().max(MAX_UPLOAD_BYTES * 1.4).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).parse(request.body);
    return service.saveMask(id, body.revision, Buffer.from(body.png, 'base64'));
  });
  app.post('/api/simulations/:id/batch', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = z.object({ revision: revisionSchema, requestId: idSchema, notes: z.string().trim().max(2000).default('') }).parse(request.body);
    const result = await service.enqueueBatch(id, body.revision, body.requestId, body.notes);
    return reply.code(202).send(result);
  });
  app.post('/api/simulations/:id/stages/:stage/generate', async (request, reply) => {
    const { id, stage } = stageParams.parse(request.params);
    const body = z.object({ revision: revisionSchema, requestId: idSchema, notes: z.string().trim().max(2000).default('') }).parse(request.body);
    const result = await service.enqueue(id, stage, body.revision, body.requestId, body.notes);
    return reply.code(202).send(result);
  });
  app.post('/api/simulations/:id/stages/:stage/review', async (request) => {
    const { id, stage } = stageParams.parse(request.params);
    const body = z.object({ revision: revisionSchema, attemptId: idSchema, decision: z.enum(['accept', 'reject']) }).parse(request.body);
    return service.review(id, stage, body.revision, body.attemptId, body.decision);
  });
  app.get('/api/simulations/:id/assets/:assetId', async (request, reply) => {
    const { id, assetId } = paramsSchema.extend({ assetId: idSchema }).parse(request.params);
    const { download } = z.object({ download: z.enum(['1']).optional() }).parse(request.query);
    const sim = service.get(id), asset = sim.assets.find((item) => item.id === assetId);
    if (!asset) throw new AppError(404, 'NOT_FOUND', 'La imagen no pertenece a esta simulación.');
    if (download) {
      const key = asset.stage;
      if (asset.kind === 'original') reply.header('Content-Disposition', 'attachment; filename="original.' + (asset.mime === 'image/jpeg' ? 'jpg' : 'png') + '"');
      else if (asset.kind === 'output' && key && isStageKey(key) && sim.stages[key].status === 'accepted' && sim.stages[key].outputAssetId === asset.id)
        reply.header('Content-Disposition', 'attachment; filename="' + STAGE_INFO[key].filename + '"');
      else throw new AppError(409, 'NOT_ACCEPTED', 'Acepta el resultado vigente antes de descargarlo.');
    }
    return reply.type(asset.mime).send(await store.read(sim, asset.id));
  });
  app.delete('/api/simulations/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const { revision } = z.object({ revision: z.coerce.number().int().min(0) }).parse(request.query);
    await service.remove(id, revision);
    return reply.code(204).send();
  });
  if (options.staticDir) {
    await app.register(staticFiles, { root: options.staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ?
      reply.code(404).send({ code: 'NOT_FOUND', error: 'Ruta no encontrada.' }) : reply.sendFile('index.html', join(options.staticDir!)));
  }
  app.addHook('onClose', () => service.close());
  return { app, service };
}
