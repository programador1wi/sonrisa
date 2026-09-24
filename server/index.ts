import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { buildApp } from './app.js';
import { GeminiProvider } from './provider.js';
import { OpenAIProvider } from './openai-provider.js';

config({ path: '.env.local', quiet: true });
config({ quiet: true });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT inválido.');
const imageProvider = process.env.IMAGE_PROVIDER ?? 'gemini';
if (imageProvider !== 'gemini' && imageProvider !== 'openai') throw new Error('IMAGE_PROVIDER debe ser gemini u openai.');
const provider = imageProvider === 'openai' ? new OpenAIProvider(process.env.OPENAI_API_KEY) : new GeminiProvider(process.env.GEMINI_API_KEY);
const model = imageProvider === 'openai' ? process.env.OPENAI_MODEL ?? 'gpt-image-2.5-sunburst' : process.env.GEMINI_MODEL ?? 'gemini-3-pro-image';
const dataDir = resolve(process.env.SONRISA_DATA_DIR ?? './data');
await mkdir(dataDir, { recursive: true });
const lock = resolve(dataDir, 'instance.lock');
async function acquireLock() {
  try { await writeFile(lock, String(process.pid), { flag: 'wx' }); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Bloqueo local inválido; revisa data/instance.lock.');
    try { process.kill(pid, 0); } catch (failure) {
      if (failure instanceof Error && 'code' in failure && failure.code === 'ESRCH') {
        await unlink(lock); await writeFile(lock, String(process.pid), { flag: 'wx' }); return;
      }
      throw failure;
    }
    throw new Error('Otra instancia usa estos datos. Cierra la instancia anterior antes de continuar.');
  }
}
await acquireLock();
const origins = ['http://127.0.0.1:5173', 'http://127.0.0.1:' + port];
try {
  const { app } = await buildApp({
    dataDir, model, provider,
    origins, ...(existsSync(resolve('dist/client/index.html')) ? { staticDir: resolve('dist/client') } : {}),
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await unlink(lock).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => { void close(); });
  process.on('SIGTERM', () => { void close(); });
  await app.listen({ port, host: '127.0.0.1' });
  console.log('Sonrisa local: http://127.0.0.1:' + port);
} catch {
  await unlink(lock).catch(() => undefined);
  console.error('No se pudo iniciar Sonrisa. Revisa el puerto, los permisos y la configuración local.');
  process.exitCode = 1;
}
