import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Store } from './store.js';
import { AppError, requireValue } from './errors.js';
import { composeDental, extractCrop, hash, inspectVisualCandidate, normalizeOriginal, prepareMask } from './images.js';
import { buildPrompt, DEFAULT_PROMPTS, PROMPT_VERSION } from '../shared/prompts.js';
import type { ImageProvider } from './provider.js';
import { busySimulation, STAGES } from '../shared/domain.js';
import type { Attempt, PromptConfig, Simulation, Stage, StageKey, VisualCheck } from '../shared/domain.js';

class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
export class SimulationService {
  // A global cap, including simultaneous batches from different studies.
  readonly concurrency = 3;
  private serial = new Serial();
  private worker?: Promise<void>;
  private shutdown = new AbortController();
  private closing = false;
  readonly timeoutMs: number;
  constructor(readonly store: Store, readonly provider: ImageProvider, readonly model: string, timeoutMs = 300_000) {
    this.timeoutMs = timeoutMs;
    store.recover();
  }
  private visualFailure(check: VisualCheck): AppError {
    return check.reason === 'CONTEXT_DRIFT'
      ? new AppError(422, 'VISUAL_CONTEXT_DRIFT', 'El proveedor cambió demasiado el borde de la boca. Este resultado se apartó para proteger labios y encuadre; revisa la máscara antes de regenerar.')
      : new AppError(422, 'VISUAL_DENTAL_DRIFT', 'El proveedor cambió demasiado los dientes originales. Este resultado se apartó; ajusta la selección o regenera la etapa y compara los dientes antes de aceptar.');
  }
  // Recheck only unreviewed results created before this safeguard. Accepted
  // results and all historical assets remain untouched.
  async auditPendingVisuals() {
    for (const snapshot of this.store.all()) for (const key of STAGES) {
      const stage = snapshot.stages[key];
      const attempt = snapshot.attempts.find((item) => item.id === stage.attemptId);
      if (stage.status !== 'needs_review' || !attempt?.candidateAssetId || attempt.visualCheck?.version === 1 ||
        !snapshot.maskAssetId || !snapshot.bounds) continue;
      let check: VisualCheck | undefined;
      let failure: AppError | undefined;
      try {
        check = await inspectVisualCandidate(
          await this.store.read(snapshot, snapshot.workingAssetId),
          await this.store.read(snapshot, snapshot.maskAssetId),
          await this.store.read(snapshot, attempt.candidateAssetId), snapshot.bounds,
        );
        if (!check.passed) failure = this.visualFailure(check);
      } catch {
        failure = new AppError(422, 'VISUAL_CHECK_FAILED', 'No se pudo verificar visualmente este resultado anterior. Revisa la máscara y genera otra versión.');
      }
      await this.serial.run(() => {
        const current = this.get(snapshot.id), active = current.stages[key];
        if (active.status !== 'needs_review' || active.attemptId !== attempt.id) return;
        const run = requireValue(current.attempts.find((item) => item.id === attempt.id));
        if (check) {
          run.visualCheck = check;
          if (run.quality) run.quality.visualCheck = check;
          if (active.quality) active.quality.visualCheck = check;
        }
        if (failure) {
          current.stages[key] = { key, version: active.version, attemptId: attempt.id, status: 'failed', error: failure.message };
          run.status = 'failed'; run.error = failure.message; run.errorCode = failure.code;
        }
        this.store.save(current);
      });
    }
  }
  get(id: string) { return requireValue(this.store.get(id)); }
  private editable(id: string, revision: number) {
    const sim = this.get(id);
    if (sim.revision !== revision) throw new AppError(409, 'STALE_REVISION', 'La simulación cambió en otra vista. Actualiza y revisa antes de continuar.');
    if (busySimulation(sim)) throw new AppError(409, 'BUSY', 'Espera a que termine la generación antes de modificar esta simulación.');
    return sim;
  }
  async upload(bytes: Buffer, filename: string) {
    const image = await normalizeOriginal(bytes);
    return this.serial.run(async () => {
      const stages = Object.fromEntries(STAGES.map((key) => [key, { key, version: 0, status: 'pending' }])) as Record<StageKey, Stage>;
      const now = new Date().toISOString();
      const sim: Simulation = {
        id: randomUUID(), name: basename(filename.replaceAll('\\', '/')).slice(0, 120) || 'Fotografía',
        createdAt: now, updatedAt: now, revision: 0, model: this.model, provider: this.provider.mode,
        originalHash: hash(bytes), originalAssetId: '', workingAssetId: '',
        width: image.width, height: image.height, maskVersion: 0, timelineVersion: 2,
        promptRevision: 0, prompts: structuredClone(DEFAULT_PROMPTS), stages, assets: [], attempts: [],
      };
      sim.originalAssetId = await this.store.put(sim, bytes, { kind: 'original', mime: image.mime });
      sim.workingAssetId = await this.store.put(sim, image.data, { kind: 'working', mime: 'image/png' });
      this.store.save(sim);
      return sim;
    });
  }
  async saveMask(id: string, revision: number, bytes: Buffer) {
    return this.serial.run(async () => {
      const sim = this.editable(id, revision);
      const { png, bounds } = await prepareMask(bytes, sim.width, sim.height);
      const original = await this.store.read(sim, sim.workingAssetId);
      const crop = await extractCrop(original, bounds);
      sim.maskVersion++;
      sim.maskAssetId = await this.store.put(sim, png, { kind: 'mask', mime: 'image/png', version: sim.maskVersion });
      sim.cropAssetId = await this.store.put(sim, crop, { kind: 'crop', mime: 'image/png', version: sim.maskVersion });
      sim.bounds = bounds;
      this.invalidate(sim, [...STAGES]);
      this.store.save(sim);
      return sim;
    });
  }
  private invalidate(sim: Simulation, stages: StageKey[]) {
    for (const key of stages) sim.stages[key] = { key, version: sim.stages[key].version, status: 'pending' };
  }
  private dependentStages(sim: Simulation, key: StageKey): StageKey[] {
    const invalid = new Set<StageKey>([key]);
    const result: StageKey[] = [];
    for (const candidate of STAGES) {
      if (candidate === key) continue;
      const attempt = sim.attempts.find((item) => item.id === sim.stages[candidate].attemptId);
      if (!attempt || ![...invalid].some((parent) =>
        sim.stages[parent].cropAssetId && attempt.references.some((ref) => ref.assetId === sim.stages[parent].cropAssetId))) continue;
      invalid.add(candidate);
      result.push(candidate);
    }
    return result;
  }
  async savePrompts(id: string, revision: number, prompts: PromptConfig) {
    return this.serial.run(() => {
      const sim = this.editable(id, revision);
      const normalized: PromptConfig = {
        common: prompts.common.trim(),
        stages: Object.fromEntries(STAGES.map((key) => [key, prompts.stages[key].trim()])) as Record<StageKey, string>,
      };
      if (JSON.stringify(sim.prompts) === JSON.stringify(normalized)) return sim;
      sim.prompts = normalized;
      sim.promptRevision++;
      this.store.save(sim);
      return sim;
    });
  }
  async selectProvider(id: string, revision: number) {
    return this.serial.run(() => {
      const sim = this.editable(id, revision);
      if (sim.attempts.length > 0 || STAGES.some((key) => sim.stages[key].status !== 'pending' || sim.stages[key].outputAssetId))
        throw new AppError(409, 'PROVIDER_LOCKED', 'Este estudio ya tiene intentos o resultados. Para cambiar de proveedor, crea una simulación nueva.');
      if (!this.provider.ready)
        throw new AppError(503, 'MISSING_KEY', 'Configura la clave del proveedor seleccionado antes de asignarlo al estudio.');
      if (sim.provider === this.provider.mode && sim.model === this.model) return sim;
      sim.provider = this.provider.mode;
      sim.model = this.model;
      this.store.save(sim);
      return sim;
    });
  }
  async enqueue(id: string, key: StageKey, revision: number, requestId: string, notes: string) {
    const result = await this.serial.run(() => {
      const fingerprint = hash(Buffer.from(JSON.stringify({ id, key, revision, notes })));
      const previous = this.store.request(requestId);
      if (previous) {
        if (previous.simulationId !== id || previous.fingerprint !== fingerprint)
          throw new AppError(409, 'REQUEST_CONFLICT', 'Este identificador ya se utilizó para una solicitud diferente.');
        return { simulation: this.get(id), attemptId: previous.attemptId, reused: true };
      }
      const sim = this.editable(id, revision);
      if ((sim.provider ?? 'gemini') !== this.provider.mode)
        throw new AppError(409, 'PROVIDER_MISMATCH', 'Esta simulación pertenece a otro proveedor de imágenes. Cambia el proveedor del estudio si aún no tiene intentos, o crea uno nuevo.');
      if (!this.provider.ready) throw new AppError(503, 'MISSING_KEY', `Configura ${this.provider.mode === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} en .env.local o .env y reinicia el servidor para generar.`);
      if (!sim.maskAssetId || !sim.cropAssetId || !sim.bounds)
        throw new AppError(409, 'MASK_REQUIRED', 'Confirma primero la región dental.');
      const references = [
        { role: 'ORIGINAL PATIENT PHOTO — mandatory primary reference; do not output this full frame', assetId: sim.originalAssetId },
        { role: 'WORK CROP — edit and return only this square crop; preserve all coordinates', assetId: sim.cropAssetId },
      ];
      const version = sim.stages[key].version + 1;
      this.invalidate(sim, [key, ...this.dependentStages(sim, key)]);
      const attempt: Attempt = {
        id: randomUUID(), requestId, stage: key, version, maskVersion: sim.maskVersion,
        model: sim.model, provider: this.provider.mode, promptVersion: PROMPT_VERSION,
        promptRevision: sim.promptRevision, promptText: buildPrompt(key, notes, sim.prompts), notes, status: 'queued',
        createdAt: new Date().toISOString(), references,
      };
      sim.stages[key] = { key, version, status: 'queued', attemptId: attempt.id };
      sim.attempts.push(attempt);
      this.store.saveRequest(sim, requestId, fingerprint, attempt.id);
      return { simulation: sim, attemptId: attempt.id, reused: false };
    });
    this.kick();
    return result;
  }
  async enqueueBatch(id: string, revision: number, requestId: string, notes: string) {
    const result = await this.serial.run(() => {
      const fingerprint = hash(Buffer.from(JSON.stringify({ id, revision, notes, operation: 'batch' })));
      const previous = this.store.request(requestId);
      if (previous) {
        if (previous.simulationId !== id || previous.fingerprint !== fingerprint)
          throw new AppError(409, 'REQUEST_CONFLICT', 'Este identificador ya se utilizó para otra solicitud.');
        return { simulation: this.get(id), batchId: previous.attemptId, reused: true };
      }
      const sim = this.editable(id, revision);
      if ((sim.provider ?? 'gemini') !== this.provider.mode)
        throw new AppError(409, 'PROVIDER_MISMATCH', 'Selecciona el proveedor de este estudio antes de generar.');
      if (!this.provider.ready) throw new AppError(503, 'MISSING_KEY', 'Configura la clave del proveedor y reinicia el servidor.');
      if (!sim.maskAssetId || !sim.cropAssetId || !sim.bounds)
        throw new AppError(409, 'MASK_REQUIRED', 'Confirma primero la región dental.');
      const keys: StageKey[] = [...STAGES];
      const batchId = randomUUID();
      this.invalidate(sim, keys);
      for (const key of keys) {
        const version = sim.stages[key].version + 1;
        const references = [
          { role: 'ORIGINAL PATIENT PHOTO — mandatory primary identity and tooth reference', assetId: sim.originalAssetId },
          { role: 'WORK CROP — return only this square crop', assetId: sim.cropAssetId },
        ];
        const attempt: Attempt = {
          id: randomUUID(), requestId, batchId, stage: key, version, maskVersion: sim.maskVersion,
          model: sim.model, provider: this.provider.mode, promptVersion: PROMPT_VERSION,
          promptRevision: sim.promptRevision, promptText: buildPrompt(key, notes, sim.prompts),
          notes, status: 'queued', createdAt: new Date().toISOString(), references,
        };
        sim.stages[key] = { key, version, status: 'queued', attemptId: attempt.id };
        sim.attempts.push(attempt);
      }
      this.store.saveRequest(sim, requestId, fingerprint, batchId);
      return { simulation: sim, batchId, reused: false };
    });
    this.kick();
    return result;
  }
  async review(id: string, key: StageKey, revision: number, attemptId: string, decision: 'accept' | 'reject') {
    return this.serial.run(() => {
      const sim = this.get(id), stage = sim.stages[key];
      // Later stages may advance the global revision while this exact candidate awaits review.
      if (revision > sim.revision)
        throw new AppError(409, 'STALE_REVISION', 'La simulación cambió en otra vista. Actualiza y revisa antes de continuar.');
      if (stage.attemptId !== attemptId || stage.status !== 'needs_review')
        throw new AppError(409, 'NOT_REVIEWABLE', 'Este candidato ya no está pendiente de revisión. Actualiza la vista.');
      if (!stage.outputAssetId || !stage.quality || stage.quality.outsideChangedPixels !== 0 || !stage.quality.originalHashVerified)
        throw new AppError(409, 'INVALID_QUALITY', 'El candidato no superó la verificación técnica.');
      const attempt = requireValue(sim.attempts.find((a) => a.id === attemptId));
      stage.status = attempt.status = decision === 'accept' ? 'accepted' : 'rejected';
      if (decision === 'reject') this.invalidate(sim, this.dependentStages(sim, key));
      this.store.save(sim);
      return sim;
    });
  }
  async remove(id: string, revision: number) {
    return this.serial.run(() => this.store.remove(this.editable(id, revision)));
  }
  private kick() {
    if (this.worker || this.closing) return;
    this.worker = this.pump().then(() => {
      this.worker = undefined;
      // An enqueue can land between the final empty check and this callback.
      if (!this.closing && this.store.all().some((sim) => STAGES.some((key) => sim.stages[key].status === 'queued'))) this.kick();
    }, (error: unknown) => { this.worker = undefined; throw error; });
    // Unexpected infrastructure errors must not become unhandled rejections or automatic paid retries.
    void this.worker.catch(() => undefined);
  }
  private async pump() {
    const active = new Set<Promise<void>>();
    try {
      while (!this.closing) {
        const snapshots = await this.serial.run(() => {
          if (this.closing) return [];
          const queued = this.store.all().flatMap((sim) => STAGES
            .filter((key) => sim.stages[key].status === 'queued')
            .map((key) => ({ sim, key, attempt: requireValue(sim.attempts.find((a) => a.id === sim.stages[key].attemptId)) })))
            .sort((a, b) => a.attempt.createdAt.localeCompare(b.attempt.createdAt))
            .slice(0, this.concurrency - active.size);
          for (const item of queued) {
            item.attempt.status = item.sim.stages[item.key].status = 'generating';
            item.attempt.startedAt = new Date().toISOString();
          }
          for (const sim of new Set(queued.map((item) => item.sim))) this.store.save(sim);
          return queued;
        });
        for (const snapshot of snapshots) {
          const work = this.processStage(snapshot).finally(() => { active.delete(work); });
          active.add(work);
        }
        if (!active.size) return;
        await Promise.race(active);
      }
    } finally {
      // Never close SQLite while another parallel stage is still saving its result.
      await Promise.allSettled(active);
    }
  }
  private async processStage({ sim, key, attempt }: { sim: Simulation; key: StageKey; attempt: Attempt }) {
    try {
        const originalBytes = await this.store.read(sim, sim.originalAssetId);
        if (hash(originalBytes) !== sim.originalHash) throw new AppError(422, 'ORIGINAL_CHANGED', 'El archivo original local cambió. No se generará una imagen a partir de él.');
        const images = await Promise.all(attempt.references.map(async (ref) => {
          const asset = requireValue(sim.assets.find((a) => a.id === ref.assetId));
          return { role: ref.role, bytes: await this.store.read(sim, ref.assetId), mime: asset.mime };
        }));
        const editMask = this.provider.mode === 'openai' ? {
          bytes: await this.store.read(sim, requireValue(sim.maskAssetId)), bounds: requireValue(sim.bounds),
        } : undefined;
        const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), this.shutdown.signal]);
        let abortHandler: (() => void) | undefined;
        const aborted = new Promise<never>((_, reject) => {
          abortHandler = () => reject(new AppError(504, 'PROVIDER_TIMEOUT', 'La espera se interrumpió. El proveedor pudo procesar la solicitud; no se repetirá automáticamente.'));
          if (signal.aborted) abortHandler();
          else signal.addEventListener('abort', abortHandler, { once: true });
        });
        const providerStarted = performance.now();
        const generated = await Promise.race([
          this.provider.generate({ model: sim.model, prompt: requireValue(attempt.promptText), images, signal,
            ...(editMask ? { editMask } : {}) }), aborted,
        ]).finally(() => { if (abortHandler) signal.removeEventListener('abort', abortHandler); });
        const providerDurationMs = Math.round(performance.now() - providerStarted);
        // Persist usage and raw candidate even if the subsequent composition fails.
        await this.serial.run(async () => {
          const current = this.get(sim.id);
          const run = requireValue(current.attempts.find((a) => a.id === attempt.id));
          run.usage = generated.usage;
          run.providerDurationMs = providerDurationMs;
          run.candidateAssetId = await this.store.put(current, generated.bytes, { kind: 'candidate', mime: generated.mime, stage: key, version: attempt.version });
          this.store.save(current);
        });
        const working = await this.store.read(sim, sim.workingAssetId);
        const mask = await this.store.read(sim, requireValue(sim.maskAssetId));
        const visualCheck = await inspectVisualCandidate(working, mask, generated.bytes, requireValue(sim.bounds));
        await this.serial.run(() => {
          const current = this.get(sim.id);
          const run = requireValue(current.attempts.find((a) => a.id === attempt.id));
          run.visualCheck = visualCheck;
          this.store.save(current);
        });
        if (!visualCheck.passed) throw this.visualFailure(visualCheck);
        const composed = await composeDental(working, mask, generated.bytes, requireValue(sim.bounds));
        composed.quality.visualCheck = visualCheck;
        composed.quality.originalHashVerified = hash(await this.store.read(sim, sim.originalAssetId)) === sim.originalHash;
        if (!composed.quality.originalHashVerified) throw new AppError(422, 'ORIGINAL_CHANGED', 'El archivo original cambió durante el procesamiento.');
        await this.serial.run(async () => {
          const current = this.get(sim.id);
          const run = requireValue(current.attempts.find((a) => a.id === attempt.id));
          const outputAssetId = await this.store.put(current, composed.png, { kind: 'output', mime: 'image/png', stage: key, version: attempt.version });
          const cropAssetId = await this.store.put(current, composed.crop, { kind: 'crop', mime: 'image/png', stage: key, version: attempt.version });
          current.stages[key] = { key, version: attempt.version, attemptId: attempt.id, status: 'needs_review', outputAssetId, cropAssetId, quality: composed.quality };
          run.status = 'needs_review'; run.completedAt = new Date().toISOString(); run.outputAssetId = outputAssetId; run.quality = composed.quality;
          this.store.save(current);
        });
    } catch (error) {
        await this.serial.run(() => {
          const current = this.get(sim.id), stage = current.stages[key];
          const run = requireValue(current.attempts.find((a) => a.id === attempt.id));
          const failure = error instanceof AppError ? error : new AppError(500, 'PROCESSING_FAILED', 'No se pudo procesar la imagen. El intento quedó registrado; revisa antes de regenerar.');
          const status = ['PROVIDER_TIMEOUT', 'PROVIDER_UNCERTAIN'].includes(failure.code) ? 'interrupted' : 'failed';
          stage.status = run.status = status; stage.error = run.error = failure.message;
          run.errorCode = failure.code; run.completedAt = new Date().toISOString();
          this.store.save(current);
        });
    }
  }
  async waitIdle() { while (this.worker) await this.worker; }
  async close() {
    this.closing = true;
    this.shutdown.abort();
    await this.worker?.catch(() => undefined);
    this.store.close();
  }
}
