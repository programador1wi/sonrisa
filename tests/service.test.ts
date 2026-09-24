import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { SimulationService } from '../server/service.js';
import { AppError } from '../server/errors.js';
import { DEFAULT_PROMPTS } from '../shared/prompts.js';
import { IMPROVED_DEFAULT_PROMPTS } from '../server/improved-prompts.js';
import { completeStage, FakeProvider, mask, photo, prepared, setup } from './helpers.js';

describe('flujo persistente', () => {
  it('conserva bytes originales, exige máscara y permite cualquier etapa desde el original', async () => {
    const ctx = await setup();
    try {
      const bytes = await photo(), sim = await ctx.service.upload(bytes, 'foto.png');
      expect(await ctx.service.store.read(sim, sim.originalAssetId)).toEqual(bytes);
      await expect(ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '')).rejects.toMatchObject({ code: 'MASK_REQUIRED' });
      const ready = await ctx.service.saveMask(sim.id, sim.revision, await mask());
      await ctx.service.enqueue(sim.id, 'final', ready.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      expect(ctx.provider.calls).toHaveLength(1);
      expect(ctx.service.get(sim.id).stages.final.status).toBe('needs_review');
      expect(ctx.service.get(sim.id).stages.month_6.status).toBe('pending');
    } finally { await ctx.close(); }
  });
  it('impide mezclar el proveedor de una simulación con el configurado después', async () => {
    const ctx = await setup();
    try {
      const sim = await prepared(ctx.service);
      sim.provider = 'openai';
      ctx.service.store.save(sim);
      await expect(ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '')).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
      expect(ctx.provider.calls).toHaveLength(0);
    } finally { await ctx.close(); }
  });
  it('permite asignar el proveedor activo antes del primer intento sin alterar foto ni máscara', async () => {
    const ctx = await setup();
    try {
      const sim = await prepared(ctx.service);
      const original = await ctx.service.store.read(sim, sim.originalAssetId);
      const maskBytes = await ctx.service.store.read(sim, sim.maskAssetId!);
      sim.provider = 'gemini';
      sim.model = 'gemini-3-pro-image';
      ctx.service.store.save(sim);
      const changed = await ctx.service.selectProvider(sim.id, sim.revision);
      expect(changed.provider).toBe('test');
      expect(changed.model).toBe(ctx.service.model);
      expect(changed.maskAssetId).toBe(sim.maskAssetId);
      expect(await ctx.service.store.read(changed, changed.originalAssetId)).toEqual(original);
      expect(await ctx.service.store.read(changed, changed.maskAssetId!)).toEqual(maskBytes);
      await ctx.service.enqueue(changed.id, 'month_6', changed.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const attempted = ctx.service.get(changed.id);
      await expect(ctx.service.selectProvider(attempted.id, attempted.revision)).rejects.toMatchObject({ code: 'PROVIDER_LOCKED' });
    } finally { await ctx.close(); }
  });
  it('un clic genera las tres etapas en paralelo con referencias idénticas sin aprobación intermedia', async () => {
    const ctx = await setup(); ctx.provider.delay = 30;
    try {
      const sim = await prepared(ctx.service);
      const requestId = randomUUID();
      const queued = await ctx.service.enqueueBatch(sim.id, sim.revision, requestId, '');
      const reused = await ctx.service.enqueueBatch(sim.id, sim.revision, requestId, '');
      expect(reused.reused).toBe(true);
      expect(reused.batchId).toBe(queued.batchId);
      await ctx.service.waitIdle();
      const generated = ctx.service.get(sim.id);
      expect(ctx.provider.calls).toHaveLength(3);
      expect(ctx.provider.maxActive).toBe(3);
      expect(ctx.provider.calls.map((call) => call.images.length)).toEqual([2, 2, 2]);
      expect(Object.values(generated.stages).every((stage) => stage.status === 'needs_review' && stage.quality?.outsideChangedPixels === 0)).toBe(true);
      expect(generated.attempts.every((attempt) => attempt.batchId === queued.batchId)).toBe(true);
      expect(generated.attempts.map((attempt) => attempt.stage)).toEqual(['month_6', 'month_18', 'final']);
      expect(generated.attempts.find((attempt) => attempt.stage === 'month_6')?.references).toHaveLength(2);
      for (const attempt of generated.attempts) {
        expect(attempt.references.map((ref) => ref.assetId)).toEqual([sim.originalAssetId, sim.cropAssetId]);
        expect(attempt.startedAt).toBeTruthy();
        expect(attempt.providerDurationMs).toBeGreaterThanOrEqual(0);
      }
      let reviewed = await ctx.service.review(sim.id, 'month_6', generated.revision, generated.stages.month_6.attemptId!, 'accept');
      reviewed = await ctx.service.review(sim.id, 'month_18', reviewed.revision, reviewed.stages.month_18.attemptId!, 'reject');
      expect(reviewed.stages.final.status).toBe('needs_review');
      const retry = await ctx.service.enqueue(sim.id, 'month_18', reviewed.revision, randomUUID(), 'Conservar el apiñamiento original');
      expect(retry.simulation.stages.final.outputAssetId).toBe(generated.stages.final.outputAssetId);
      await ctx.service.waitIdle();
    } finally { await ctx.close(); }
  });
  it('guarda prompts por estudio y congela el texto exacto de cada intento', async () => {
    const ctx = await setup();
    try {
      let sim = await prepared(ctx.service);
      const prompts = structuredClone(sim.prompts);
      prompts.common += '\nKEEP A PARTICULAR NATURAL TOOTH EDGE.';
      prompts.stages.month_18 += ' RETAIN SOME CROWDING.';
      sim = await ctx.service.savePrompts(sim.id, sim.revision, prompts);
      expect(sim.promptRevision).toBe(1);
      await ctx.service.enqueueBatch(sim.id, sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const generated = ctx.service.get(sim.id);
      expect(ctx.provider.calls).toHaveLength(3);
      expect(ctx.provider.calls[0]?.prompt).toContain('KEEP A PARTICULAR NATURAL TOOTH EDGE.');
      expect(ctx.provider.calls.find((call) => call.prompt.includes('STAGE: 18 meses'))?.prompt).toContain('RETAIN SOME CROWDING.');
      expect(ctx.provider.calls.find((call) => call.prompt.includes('STAGE: Resultado final'))?.prompt).not.toContain('RETAIN SOME CROWDING.');
      expect(generated.attempts.map((attempt) => attempt.promptText).sort()).toEqual(ctx.provider.calls.map((call) => call.prompt).sort());
      const savedText = generated.attempts[1]?.promptText;
      const nextPrompts = structuredClone(generated.prompts);
      nextPrompts.stages.month_18 = 'DIFFERENT TEXT';
      const updated = await ctx.service.savePrompts(sim.id, generated.revision, nextPrompts);
      expect(updated.promptRevision).toBe(2);
      expect(updated.attempts[1]?.promptText).toBe(savedText);
      expect(updated.stages.month_18.status).toBe('needs_review');
    } finally { await ctx.close(); }
  });
  it('migra estudios anteriores conservando original, máscara, archivos e intentos históricos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sonrisa-legacy-'));
    const store = await Store.open(dir);
    const service = new SimulationService(store, new FakeProvider(), 'test-model');
    let id = '';
    let originalId = '';
    let maskId = '';
    try {
      let sim = await prepared(service);
      sim = await completeStage(service, sim, 'month_6');
      id = sim.id; originalId = sim.originalAssetId; maskId = sim.maskAssetId!;
      const legacy = structuredClone(sim) as unknown as Record<string, unknown>;
      delete legacy.timelineVersion;
      delete legacy.promptRevision;
      delete legacy.prompts;
      legacy.stages = {
        month_6: sim.stages.month_6,
        year_1: { key: 'year_1', version: 1, status: 'accepted' },
        year_2: { key: 'year_2', version: 1, status: 'accepted' },
        final: { key: 'final', version: 1, status: 'accepted' },
      };
      legacy.attempts = [...sim.attempts, { ...sim.attempts[0], id: randomUUID(), stage: 'year_2', status: 'accepted' }];
      store.save(legacy as unknown as typeof sim);
    } finally { await service.close(); }
    const reopened = await Store.open(dir);
    try {
      const migrated = reopened.get(id)!;
      expect(Object.keys(migrated.stages)).toEqual(['month_6', 'month_18', 'final']);
      expect(Object.values(migrated.stages).map((stage) => stage.status)).toEqual(['pending', 'pending', 'pending']);
      expect(migrated.stages.month_6.version).toBe(1);
      expect(migrated.stages.final.version).toBe(1);
      expect(migrated.attempts.map((attempt) => attempt.stage)).toEqual(['month_6', 'year_2']);
      expect(migrated.prompts).toEqual(DEFAULT_PROMPTS);
      expect(await reopened.read(migrated, originalId)).toEqual(await photo());
      expect(await reopened.read(migrated, maskId)).toEqual(await mask());
    } finally { reopened.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it('un lote conserva el historial al reemplazar salidas y registra cada fallo sin reintentar', async () => {
    const accepted = await setup(); accepted.provider.delay = 25;
    try {
      let sim = await prepared(accepted.service);
      for (const key of ['month_6', 'month_18', 'final'] as const)
        sim = await completeStage(accepted.service, sim, key);
      const oldFinalAttemptId = sim.stages.final.attemptId;
      const oldFinalOutputId = sim.stages.final.outputAssetId;
      await accepted.service.enqueueBatch(sim.id, sim.revision, randomUUID(), '');
      await accepted.service.waitIdle();
      expect(accepted.provider.calls).toHaveLength(6);
      expect(accepted.provider.maxActive).toBe(3);
      const result = accepted.service.get(sim.id);
      expect(result.stages.final.status).toBe('needs_review');
      expect(result.stages.final.attemptId).not.toBe(oldFinalAttemptId);
      expect(result.assets.some((asset) => asset.id === oldFinalOutputId)).toBe(true);
      expect(result.attempts.some((attempt) => attempt.id === oldFinalAttemptId && attempt.status === 'accepted')).toBe(true);
    } finally { await accepted.close(); }
    const failed = await setup(); failed.provider.failure = new AppError(429, 'PROVIDER_QUOTA', 'Cuota agotada.');
    try {
      const sim = await prepared(failed.service);
      await failed.service.enqueueBatch(sim.id, sim.revision, randomUUID(), '');
      await failed.service.waitIdle();
      const result = failed.service.get(sim.id);
      expect(failed.provider.calls).toHaveLength(3);
      expect(result.stages.month_6.status).toBe('failed');
      expect(result.attempts.every((attempt) => attempt.status === 'failed' && attempt.errorCode === 'PROVIDER_QUOTA')).toBe(true);
    } finally { await failed.close(); }
  });
  it('completa tres etapas independientes; cambiar máscara invalida todas conservando historial', async () => {
    const ctx = await setup();
    try {
      let sim = await prepared(ctx.service);
      for (const key of ['month_6', 'month_18', 'final'] as const) sim = await completeStage(ctx.service, sim, key);
      expect(ctx.provider.calls).toHaveLength(3);
      expect(ctx.provider.calls.map((call) => call.images.length)).toEqual([2, 2, 2]);
      expect(sim.attempts.every((a) => a.quality?.outsideChangedPixels === 0 && a.quality.originalHashVerified)).toBe(true);
      const oldOutput = sim.stages.month_6.outputAssetId!;
      await ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), 'Conservar tamaño');
      await ctx.service.waitIdle();
      sim = ctx.service.get(sim.id);
      expect(sim.stages.final.status).toBe('accepted');
      expect(sim.stages.month_18.status).toBe('accepted');
      expect(sim.assets.some((a) => a.id === oldOutput)).toBe(true);
      expect(sim.attempts.find((a) => a.outputAssetId === oldOutput)?.status).toBe('accepted');
      sim = await ctx.service.saveMask(sim.id, sim.revision, await mask());
      expect(Object.values(sim.stages).every((stage) => stage.status === 'pending')).toBe(true);
      expect(sim.maskVersion).toBe(2);
    } finally { await ctx.close(); }
  });
  it('idempotencia evita dos llamadas y rechaza reutilización con otro cuerpo', async () => {
    const ctx = await setup(); ctx.provider.delay = 50;
    try {
      const sim = await prepared(ctx.service), requestId = randomUUID();
      const first = await ctx.service.enqueue(sim.id, 'month_6', sim.revision, requestId, '');
      const repeated = await ctx.service.enqueue(sim.id, 'month_6', sim.revision, requestId, '');
      expect(first.attemptId).toBe(repeated.attemptId);
      expect(repeated.reused).toBe(true);
      await expect(ctx.service.enqueue(sim.id, 'month_6', sim.revision, requestId, 'diferente')).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
      await ctx.service.waitIdle();
      expect(ctx.provider.calls).toHaveLength(1);
    } finally { await ctx.close(); }
  });
  it('mantiene tres llamadas concurrentes como máximo y ocupa un hueco sin esperar al lote entero', async () => {
    const ctx = await setup();
    const release: Array<() => void> = [];
    ctx.provider.beforeResult = () => new Promise<void>((resolve) => { release.push(resolve); });
    try {
      const a = await prepared(ctx.service), b = await prepared(ctx.service);
      await ctx.service.enqueueBatch(a.id, a.revision, randomUUID(), '');
      await expect.poll(() => release.length).toBe(3);
      expect(ctx.provider.active).toBe(3);
      await ctx.service.enqueueBatch(b.id, b.revision, randomUUID(), '');
      expect(Object.values(ctx.service.get(b.id).stages).every((stage) => stage.status === 'queued')).toBe(true);
      release[0]!();
      await expect.poll(() => release.length).toBe(4);
      expect(ctx.provider.active).toBe(3);
      // Two requests from the first study still wait when the second study begins.
      expect(Object.values(ctx.service.get(a.id).stages).filter((stage) => stage.status === 'generating')).toHaveLength(2);
      ctx.provider.beforeResult = undefined;
      release.forEach((resolve) => resolve());
      await ctx.service.waitIdle();
      expect(ctx.provider.calls).toHaveLength(6);
      expect(ctx.provider.maxActive).toBe(3);
      for (const id of [a.id, b.id]) {
        const sim = ctx.service.get(id);
        expect(Object.values(sim.stages).every((stage) => stage.status === 'needs_review')).toBe(true);
        expect(new Set(sim.attempts.map((attempt) => attempt.outputAssetId)).size).toBe(3);
      }
    } finally { release.forEach((resolve) => resolve()); await ctx.close(); }
  });
  it('un fallo no cancela las otras etapas y revisar una no se pierde al terminar otra', async () => {
    const ctx = await setup();
    let releaseFinal = () => {};
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
    ctx.provider.beforeResult = async (input) => {
      if (input.prompt.includes('STAGE: 18 meses')) throw new AppError(422, 'NO_SINGLE_IMAGE', 'Sin imagen.');
      if (input.prompt.includes('STAGE: Resultado final')) await finalGate;
    };
    try {
      const sim = await prepared(ctx.service);
      await ctx.service.enqueueBatch(sim.id, sim.revision, randomUUID(), '');
      await expect.poll(() => ctx.service.get(sim.id).stages.month_6.status).toBe('needs_review');
      const ready = ctx.service.get(sim.id);
      await ctx.service.review(sim.id, 'month_6', ready.revision, ready.stages.month_6.attemptId!, 'accept');
      releaseFinal();
      await ctx.service.waitIdle();
      const result = ctx.service.get(sim.id);
      expect(Object.values(result.stages).map((stage) => stage.status)).toEqual(['accepted', 'failed', 'needs_review']);
      expect(ctx.provider.calls).toHaveLength(3);
      expect(result.attempts.every((attempt) => attempt.completedAt)).toBe(true);
    } finally { releaseFinal(); await ctx.close(); }
  });
  it('restaura los prompts anteriores sin sobrescribir textos personalizados ni resultados', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sonrisa-prompts-'));
    let store = await Store.open(dir);
    const service = new SimulationService(store, new FakeProvider(), 'test-model');
    let sim = await prepared(service);
    sim = await completeStage(service, sim, 'month_6');
    const originalAttempt = structuredClone(sim.attempts[0]);
    sim.prompts = structuredClone(IMPROVED_DEFAULT_PROMPTS);
    sim.prompts.stages.month_18 = 'CONSERVAR MI INSTRUCCIÓN PERSONALIZADA';
    store.save(sim);
    await service.close();
    try {
      store = await Store.open(dir);
      const updated = store.get(sim.id)!;
      expect(updated.prompts.common).toBe(DEFAULT_PROMPTS.common);
      expect(updated.prompts.stages.month_6).toBe(DEFAULT_PROMPTS.stages.month_6);
      expect(updated.prompts.stages.final).toBe(DEFAULT_PROMPTS.stages.final);
      expect(updated.prompts.stages.month_18).toBe(sim.prompts.stages.month_18);
      expect(updated.promptRevision).toBe(sim.promptRevision + 1);
      expect(updated.stages).toEqual(sim.stages);
      expect(updated.attempts[0]).toEqual(originalAttempt);
      expect(await store.read(updated, updated.originalAssetId)).toEqual(await photo());
      store.close();
      store = await Store.open(dir);
      expect(store.get(sim.id)!.revision).toBe(updated.revision);
    } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it('sigue invalidando dependencias históricas reales de una secuencia anterior', async () => {
    const ctx = await setup();
    try {
      let sim = await prepared(ctx.service);
      for (const key of ['month_6', 'month_18', 'final'] as const) sim = await completeStage(ctx.service, sim, key);
      for (const [child, parent] of [['month_18', 'month_6'], ['final', 'month_18']] as const) {
        sim.attempts.find((a) => a.id === sim.stages[child].attemptId)!.references.push({ role: 'LEGACY PREVIOUS STAGE', assetId: sim.stages[parent].cropAssetId! });
      }
      ctx.service.store.save(sim);
      await ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const updated = ctx.service.get(sim.id);
      expect(updated.stages.month_18.status).toBe('pending');
      expect(updated.stages.final.status).toBe('pending');
      expect(updated.attempts).toHaveLength(4);
    } finally { await ctx.close(); }
  });
  it('atiende generaciones de simulaciones distintas', async () => {
    const ctx = await setup(); ctx.provider.delay = 25;
    try {
      const a = await prepared(ctx.service), b = await prepared(ctx.service);
      await ctx.service.enqueue(a.id, 'month_6', a.revision, randomUUID(), '');
      await ctx.service.enqueue(b.id, 'month_6', b.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      expect(ctx.service.get(a.id).stages.month_6.status).toBe('needs_review');
      expect(ctx.service.get(b.id).stages.month_6.status).toBe('needs_review');
      expect(ctx.provider.calls).toHaveLength(2);
    } finally { await ctx.close(); }
  });
  it('guarda errores sin reintentar ni modificar el original', async () => {
    const ctx = await setup();
    ctx.provider.failure = new AppError(429, 'PROVIDER_QUOTA', 'Cuota agotada.');
    try {
      const sim = await prepared(ctx.service);
      await ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      expect(ctx.provider.calls).toHaveLength(1);
      expect(ctx.service.get(sim.id).stages.month_6.status).toBe('failed');
      expect(ctx.service.get(sim.id).attempts[0]?.errorCode).toBe('PROVIDER_QUOTA');
      expect(await ctx.service.store.read(sim, sim.originalAssetId)).toEqual(await photo());
    } finally { await ctx.close(); }
  });
  it('aparta un recorte visualmente desviado, conserva la evidencia y permite regenerar solo esa etapa', async () => {
    const ctx = await setup(); ctx.provider.overpaint = true;
    try {
      const sim = await prepared(ctx.service);
      await ctx.service.enqueue(sim.id, 'month_18', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const flagged = ctx.service.get(sim.id);
      expect(flagged.stages.month_18.status).toBe('failed');
      expect(flagged.stages.month_18.outputAssetId).toBeUndefined();
      expect(flagged.attempts[0]).toMatchObject({ errorCode: 'VISUAL_CONTEXT_DRIFT', visualCheck: { passed: false } });
      expect(flagged.attempts[0]?.candidateAssetId).toBeTruthy();
      expect(await ctx.service.store.read(flagged, flagged.originalAssetId)).toEqual(await photo());
      ctx.provider.overpaint = false;
      await ctx.service.enqueue(sim.id, 'month_18', flagged.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const retried = ctx.service.get(sim.id);
      expect(retried.stages.month_18.status).toBe('needs_review');
      expect(retried.stages.month_18.quality?.visualCheck?.passed).toBe(true);
      expect(retried.attempts[0]?.candidateAssetId).toBe(flagged.attempts[0]?.candidateAssetId);
      expect(ctx.provider.calls).toHaveLength(2);
    } finally { await ctx.close(); }
  });
  it('revisa resultados pendientes antiguos sin cambiar fotografías aceptadas', async () => {
    const ctx = await setup();
    try {
      let sim = await prepared(ctx.service);
      sim = await completeStage(ctx.service, sim, 'month_6');
      await ctx.service.enqueue(sim.id, 'month_18', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      sim = ctx.service.get(sim.id);
      const acceptedOutput = sim.stages.month_6.outputAssetId;
      const oldOutput = sim.stages.month_18.outputAssetId;
      const badCandidate = await ctx.service.store.put(sim,
        await sharp({ create: { width: 128, height: 128, channels: 3, background: '#ffffff' } }).png().toBuffer(),
        { kind: 'candidate', mime: 'image/png', stage: 'month_18', version: sim.stages.month_18.version });
      const attempt = sim.attempts.find((item) => item.id === sim.stages.month_18.attemptId)!;
      attempt.candidateAssetId = badCandidate;
      attempt.visualCheck = undefined;
      ctx.service.store.save(sim);
      await ctx.service.auditPendingVisuals();
      const checked = ctx.service.get(sim.id);
      expect(checked.stages.month_6.status).toBe('accepted');
      expect(checked.stages.month_6.outputAssetId).toBe(acceptedOutput);
      expect(checked.stages.month_18.status).toBe('failed');
      expect(checked.stages.month_18.outputAssetId).toBeUndefined();
      expect(checked.attempts.find((item) => item.id === attempt.id)?.outputAssetId).toBe(oldOutput);
      const revision = checked.revision;
      await ctx.service.auditPendingVisuals();
      expect(ctx.service.get(sim.id).revision).toBe(revision);
    } finally { await ctx.close(); }
  });
  it('timeout persiste resultado desconocido', async () => {
    const ctx = await setup(new FakeProvider(), 5); ctx.provider.delay = 40;
    try {
      const sim = await prepared(ctx.service);
      await ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      expect(ctx.service.get(sim.id).stages.month_6.status).toBe('interrupted');
      expect(ctx.provider.calls).toHaveLength(1);
    } finally { await ctx.close(); }
  });
  it('permite revisar el mismo candidato con revisión global anterior y bloquea duplicados y descargas pendientes', async () => {
    const ctx = await setup();
    try {
      const sim = await prepared(ctx.service);
      await ctx.service.enqueue(sim.id, 'month_6', sim.revision, randomUUID(), '');
      await ctx.service.waitIdle();
      const current = ctx.service.get(sim.id);
      const response = await ctx.app.inject({ url: '/api/simulations/' + sim.id + '/assets/' + current.stages.month_6.outputAssetId + '?download=1', headers: { host: '127.0.0.1:3001' } });
      expect(response.statusCode).toBe(409);
      const reviewed = await ctx.service.review(sim.id, 'month_6', sim.revision, current.stages.month_6.attemptId!, 'accept');
      expect(reviewed.stages.month_6.status).toBe('accepted');
      await expect(ctx.service.review(sim.id, 'month_6', sim.revision, current.stages.month_6.attemptId!, 'accept')).rejects.toMatchObject({ code: 'NOT_REVIEWABLE' });
    } finally { await ctx.close(); }
  });
  it('recupera trabajos tras reinicio sin iniciar otra generación', async () => {
    const ctx = await setup();
    const sim = await prepared(ctx.service);
    sim.stages.final = { key: 'final', version: 1, status: 'generating', attemptId: randomUUID() };
    ctx.service.store.save(sim);
    await ctx.app.close();
    const reopened = new SimulationService(await Store.open(ctx.dir), ctx.provider, 'gemini-3-pro-image');
    try {
      expect(reopened.get(sim.id).stages.final.status).toBe('interrupted');
      expect(ctx.provider.calls).toHaveLength(0);
    } finally { await reopened.close(); await ctx.close(); }
  });
});
