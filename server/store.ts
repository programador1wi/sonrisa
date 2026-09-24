import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Simulation, Asset, HistoryPage } from '../shared/domain.js';
import { busySimulation, STAGES, ALL_STAGE_KEYS, type Stage, type StageKey } from '../shared/domain.js';
import { DEFAULT_PROMPTS } from '../shared/prompts.js';
import { IMPROVED_DEFAULT_PROMPTS } from './improved-prompts.js';
import { AppError } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class Store {
  private constructor(public root: string, private db: DatabaseSync) {}
  static async open(root: string) {
    root = resolve(root);
    await mkdir(root, { recursive: true });
    const db = new DatabaseSync(join(root, 'sonrisa.sqlite'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS simulations (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, simulation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, attempt_id TEXT NOT NULL);');
    const store = new Store(root, db);
    store.migrateTimeline();
    return store;
  }
  private migrateTimeline() {
    const rows = this.db.prepare('SELECT document FROM simulations').all();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const sim = JSON.parse(String(row.document)) as Simulation;
        let changed = false;
        if (sim.timelineVersion !== 2 || !sim.stages.month_18) {
          const oldMonth6 = sim.stages.month_6;
          const oldFinal = sim.stages.final;
          sim.stages = {
            month_6: { key: 'month_6', version: oldMonth6?.version ?? 0, status: 'pending' },
            month_18: { key: 'month_18', version: 0, status: 'pending' },
            final: { key: 'final', version: oldFinal?.version ?? 0, status: 'pending' },
          } as Record<StageKey, Stage>;
          sim.timelineVersion = 2;
          sim.migratedFromLegacyTimeline = true;
          for (const attempt of sim.attempts) {
            if (attempt.status !== 'queued' && attempt.status !== 'generating') continue;
            attempt.status = 'interrupted';
            attempt.error = 'La secuencia anterior cambió mientras este intento estaba en curso. Revisa el historial antes de generar de nuevo.';
            attempt.errorCode = 'TIMELINE_MIGRATED';
            attempt.completedAt = new Date().toISOString();
          }
          changed = true;
        }
        if (!sim.prompts || !Number.isInteger(sim.promptRevision)) {
          sim.prompts = structuredClone(DEFAULT_PROMPTS);
          sim.promptRevision = 0;
          changed = true;
        } else {
          // Reverse the v5 default migration without touching custom fields or attempt snapshots.
          let restored = false;
          if (sim.prompts.common.trim() === IMPROVED_DEFAULT_PROMPTS.common) {
            sim.prompts.common = DEFAULT_PROMPTS.common;
            restored = true;
          }
          for (const key of STAGES) if (sim.prompts.stages[key]?.trim() === IMPROVED_DEFAULT_PROMPTS.stages[key]) {
            sim.prompts.stages[key] = DEFAULT_PROMPTS.stages[key];
            restored = true;
          }
          if (restored) { sim.promptRevision++; changed = true; }
        }
        if (!changed) continue;
        sim.revision++;
        sim.updatedAt = new Date().toISOString();
        this.db.prepare('UPDATE simulations SET updated_at = ?, document = ? WHERE id = ?')
          .run(sim.updatedAt, JSON.stringify(sim), sim.id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id: string): Simulation | undefined {
    const row = this.db.prepare('SELECT document FROM simulations WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.document)) as Simulation : undefined;
  }
  all(): Simulation[] {
    return this.db.prepare('SELECT document FROM simulations ORDER BY updated_at DESC, id').all()
      .map((row) => JSON.parse(String(row.document)) as Simulation);
  }
  history(offset: number, limit = 20): HistoryPage {
    const rows = this.db.prepare('SELECT document FROM simulations ORDER BY updated_at DESC, id LIMIT ? OFFSET ?').all(limit + 1, offset);
    return {
      items: rows.slice(0, limit).map((row) => {
        const sim = JSON.parse(String(row.document)) as Simulation;
        return { id: sim.id, name: sim.name, createdAt: sim.createdAt, updatedAt: sim.updatedAt,
          originalAssetId: sim.originalAssetId, width: sim.width, height: sim.height,
          accepted: ALL_STAGE_KEYS.filter((key) => sim.stages[key]?.status === 'accepted').length, busy: busySimulation(sim) };
      }),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  save(sim: Simulation) {
    sim.revision++;
    sim.updatedAt = new Date().toISOString();
    this.db.prepare('INSERT INTO simulations VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, document=excluded.document').run(sim.id, sim.updatedAt, JSON.stringify(sim));
  }
  request(id: string) {
    const row = this.db.prepare('SELECT simulation_id, fingerprint, attempt_id FROM requests WHERE id=?').get(id);
    return row ? { simulationId: String(row.simulation_id), fingerprint: String(row.fingerprint), attemptId: String(row.attempt_id) } : undefined;
  }
  saveRequest(sim: Simulation, id: string, fingerprint: string, attemptId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.save(sim);
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?)').run(id, sim.id, fingerprint, attemptId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private directory(id: string) {
    if (!UUID.test(id)) throw new AppError(400, 'INVALID_ID', 'Identificador de simulación inválido.');
    const path = resolve(this.root, id);
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe storage path');
    return path;
  }
  async put(sim: Simulation, bytes: Buffer, metadata: Omit<Asset, 'id'>): Promise<string> {
    const dir = this.directory(sim.id), id = randomUUID();
    await mkdir(dir, { recursive: true });
    const target = join(dir, id);
    await writeFile(target + '.tmp', bytes, { flag: 'wx' });
    await rename(target + '.tmp', target);
    sim.assets.push({ id, ...metadata });
    return id;
  }
  async read(sim: Simulation, assetId: string): Promise<Buffer> {
    if (!UUID.test(assetId) || !sim.assets.some((asset) => asset.id === assetId))
      throw new AppError(404, 'ASSET_NOT_FOUND', 'La imagen no pertenece a esta simulación.');
    try { return await readFile(join(this.directory(sim.id), assetId)); } catch {
      throw new AppError(404, 'ASSET_MISSING', 'No se encontró el archivo local de esta imagen.');
    }
  }
  async remove(sim: Simulation) {
    const dir = this.directory(sim.id);
    await rm(dir, { recursive: true, force: true });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM requests WHERE simulation_id=?').run(sim.id);
      this.db.prepare('DELETE FROM simulations WHERE id=?').run(sim.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recover() {
    for (const sim of this.all()) {
      let changed = false;
      for (const key of STAGES) {
        const stage = sim.stages[key];
        if (!['queued', 'generating'].includes(stage.status)) continue;
        stage.status = 'interrupted';
        stage.error = 'La aplicación se cerró durante el trabajo. El proveedor pudo haberlo procesado; revisa antes de regenerar.';
        const attempt = sim.attempts.find((a) => a.id === stage.attemptId);
        if (attempt) { attempt.status = 'interrupted'; attempt.error = stage.error; attempt.errorCode = 'RESTARTED'; attempt.completedAt = new Date().toISOString(); }
        changed = true;
      }
      if (changed) this.save(sim);
    }
  }
  close() { this.db.close(); }
}
