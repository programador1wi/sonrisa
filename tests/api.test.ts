import { expect, it } from 'vitest';
import { setup, prepared } from './helpers.js';
import { randomUUID } from 'node:crypto';

it('bloquea origen ajeno, DNS rebinding y referencias cruzadas de archivos', async () => {
  const ctx = await setup();
  try {
    expect((await ctx.app.inject({ url: '/api/health', headers: { host: 'attacker.test:3001' } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ url: '/api/health', headers: { host: '127.0.0.1:3001', origin: 'https://attacker.test' } })).statusCode).toBe(403);
    const a = await prepared(ctx.service), b = await prepared(ctx.service);
    const response = await ctx.app.inject({ url: '/api/simulations/' + a.id + '/assets/' + b.originalAssetId, headers: { host: '127.0.0.1:3001' } });
    expect(response.statusCode).toBe(404);
    const headers = { host: '127.0.0.1:3001', 'content-type': 'application/json' };
    expect((await ctx.app.inject({ method: 'POST', url: '/api/simulations/' + a.id + '/stages/not-a-stage/generate', headers, payload: { revision: a.revision, requestId: randomUUID() } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ url: '/api/simulations/' + a.id + '/assets/' + a.originalAssetId, headers })).headers['cache-control']).toBe('no-store');
  } finally { await ctx.close(); }
});

it('expone ausencia de clave sin revelar secretos y permite preparar fotos', async () => {
  const ctx = await setup(); ctx.provider.ready = false;
  try {
    const sim = await prepared(ctx.service);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/simulations/' + sim.id + '/stages/final/generate', headers: { host: '127.0.0.1:3001' }, payload: { revision: sim.revision, requestId: randomUUID(), notes: '' } });
    expect(response.statusCode).toBe(503);
    expect(ctx.provider.calls).toHaveLength(0);
    expect(ctx.service.get(sim.id).maskVersion).toBe(1);
  } finally { await ctx.close(); }
});

it('valida y versiona prompts editables sin tocar la fotografía ni aceptar guardados obsoletos', async () => {
  const ctx = await setup();
  try {
    const sim = await prepared(ctx.service);
    const headers = { host: '127.0.0.1:3001', 'content-type': 'application/json' };
    const url = '/api/simulations/' + sim.id + '/prompts';
    const invalid = structuredClone(sim.prompts);
    invalid.stages.month_18 = '   ';
    expect((await ctx.app.inject({ method: 'PUT', url, headers, payload: { revision: sim.revision, prompts: invalid } })).statusCode).toBe(400);
    expect(ctx.service.get(sim.id).promptRevision).toBe(0);
    const prompts = structuredClone(sim.prompts);
    prompts.stages.month_18 += ' KEEP A SMALL GAP.';
    const saved = await ctx.app.inject({ method: 'PUT', url, headers, payload: { revision: sim.revision, prompts } });
    expect(saved.statusCode).toBe(200);
    expect(ctx.service.get(sim.id).promptRevision).toBe(1);
    expect(ctx.service.get(sim.id).originalHash).toBe(sim.originalHash);
    expect((await ctx.app.inject({ method: 'PUT', url, headers, payload: { revision: sim.revision, prompts } })).statusCode).toBe(409);
    expect(ctx.provider.calls).toHaveLength(0);
  } finally { await ctx.close(); }
});
