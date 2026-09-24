import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../../server/app.js';
import { FakeProvider } from '../helpers.js';
import { AppError } from '../../server/errors.js';

export default async function globalSetup() {
  const dir = await mkdtemp(join(tmpdir(), 'sonrisa-e2e-'));
  const provider = new FakeProvider();
  provider.delay = 1200;
  const { app } = await buildApp({
    dataDir: dir, provider, model: 'gemini-3-pro-image',
    staticDir: resolve('dist/client'), origins: ['http://127.0.0.1:4173'],
  });
  app.get('/__test/provider', async () => ({ calls: provider.calls.length, active: provider.active, maxActive: provider.maxActive }));
  app.post('/__test/provider', async (request) => {
    const body = request.body as { fail?: boolean; overpaint?: boolean };
    provider.failure = body.fail ? new AppError(429, 'PROVIDER_QUOTA', 'Cuota de prueba agotada.') : undefined;
    provider.overpaint = body.overpaint === true;
    provider.calls = [];
    provider.maxActive = 0;
    return { ready: true };
  });
  await app.listen({ host: '127.0.0.1', port: 4173 });
  return async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  };
}
