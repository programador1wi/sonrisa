import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const healthUrl = 'http://127.0.0.1:3001/api/health';
const deadline = Date.now() + 30_000;
let available = false;

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    if (response.ok) { available = true; break; }
  } catch { /* The API process is still starting. */ }
  await delay(200);
}

if (!available) {
  console.error('La API local no respondió en 30 segundos. Revisa los mensajes [api] antes de abrir la interfaz.');
  process.exitCode = 1;
} else {
  const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], { stdio: 'inherit' });
  process.on('SIGINT', () => vite.kill('SIGINT'));
  process.on('SIGTERM', () => vite.kill('SIGTERM'));
  vite.on('error', () => {
    console.error('No se pudo iniciar Vite. Comprueba que las dependencias estén instaladas.');
    process.exitCode = 1;
  });
  vite.on('exit', (code) => { process.exitCode = code ?? 1; });
}
