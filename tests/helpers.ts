import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationInput, ImageProvider } from '../server/provider.js';
import { buildApp } from '../server/app.js';
import type { Simulation } from '../shared/domain.js';
import { randomUUID } from 'node:crypto';

export const photo = () => sharp({ create: { width: 120, height: 90, channels: 3, background: '#73828f' } }).png().toBuffer();
export async function mask(width = 120, height = 90) {
  const pixels = Buffer.alloc(width * height);
  for (let y = Math.floor(height * .4); y < Math.floor(height * .6); y++)
    for (let x = Math.floor(width * .3); x < Math.floor(width * .7); x++) pixels[y * width + x] = 255;
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}
export class FakeProvider implements ImageProvider {
  readonly mode = 'test' as const;
  ready = true;
  calls: GenerationInput[] = [];
  active = 0;
  maxActive = 0;
  failure?: Error;
  overpaint = false;
  delay = 0;
  beforeResult?: (input: GenerationInput) => Promise<void>;
  async generate(input: GenerationInput) {
    this.calls.push(input);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await this.beforeResult?.(input);
      if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
      if (this.failure) throw this.failure;
      if (this.overpaint) return {
        bytes: await sharp({ create: { width: 128, height: 128, channels: 3, background: '#ffffff' } }).png().toBuffer(),
        mime: 'image/png' as const, usage: { total_tokens: 42 },
      };
      const crop = input.images.find((image) => image.role.startsWith('WORK CROP'));
      if (!crop) throw new Error('Missing synthetic source crop');
      const pixels = await sharp(crop.bytes).removeAlpha().resize(128, 128).raw().toBuffer();
      // A small artificial mark exercises composition without replacing the dentition.
      for (let y = 63; y <= 64; y++) for (let x = 55; x <= 73; x++) {
        const offset = (y * 128 + x) * 3;
        pixels[offset] = 170; pixels[offset + 1] = 175; pixels[offset + 2] = 180;
      }
      return {
        bytes: await sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer(),
        mime: 'image/png' as const, usage: { total_tokens: 42 },
      };
    } finally { this.active--; }
  }
}
export async function setup(provider = new FakeProvider(), timeoutMs = 300_000) {
  const dir = await mkdtemp(join(tmpdir(), 'sonrisa-test-'));
  const { app, service } = await buildApp({ dataDir: dir, model: 'gemini-3-pro-image', provider, timeoutMs });
  await app.ready();
  return { dir, app, service, provider, close: async () => { await app.close(); await rm(dir, { force: true, recursive: true }); } };
}
export async function prepared(service: Awaited<ReturnType<typeof setup>>['service']): Promise<Simulation> {
  const sim = await service.upload(await photo(), 'referencia.png');
  return service.saveMask(sim.id, sim.revision, await mask());
}
export async function completeStage(service: Awaited<ReturnType<typeof setup>>['service'], sim: Simulation, key: keyof Simulation['stages']) {
  await service.enqueue(sim.id, key, sim.revision, randomUUID(), '');
  await service.waitIdle();
  const generated = service.get(sim.id);
  return service.review(sim.id, key, generated.revision, generated.stages[key].attemptId!, 'accept');
}
