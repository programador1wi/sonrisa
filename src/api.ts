import type { Health, HistoryPage, PromptConfig, Simulation, StageKey, StudioSection } from '../shared/domain';
import { MAX_UPLOAD_BYTES } from '../shared/domain';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
async function read<T>(pending: Promise<Response> | Response): Promise<T> {
  const response = await pending;
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; error?: string };
    throw new ApiError(response.status, body.code ?? 'NETWORK_ERROR', body.error ?? 'No se pudo completar la solicitud. Comprueba la conexión local.');
  }
  return response.json() as Promise<T>;
}
const json = (method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
export const api = {
  health: () => read<Health>(fetch('/api/health')),
  history: (offset = 0) => read<HistoryPage>(fetch('/api/simulations?offset=' + offset)),
  get: (id: string) => read<Simulation>(fetch('/api/simulations/' + encodeURIComponent(id))),
  prompts: (sim: Simulation, prompts: PromptConfig) =>
    read<Simulation>(json('PUT', '/api/simulations/' + sim.id + '/prompts', { revision: sim.revision, prompts })),
  providers: () => read<{
    active: string;
    activeModel: string;
    providers: Array<{ mode: string; name: string; model: string; ready: boolean }>;
  }>(fetch('/api/providers')),
  switchProvider: (mode: 'gemini' | 'openai') =>
    read<{ active: string; activeModel: string; ready: boolean }>(
      json('POST', '/api/providers/switch', { mode })
    ),
  selectProvider: (sim: Simulation) =>
    read<Simulation>(json('POST', '/api/simulations/' + sim.id + '/provider', { revision: sim.revision })),
  mask: (sim: Simulation, png: string) =>
    read<Simulation>(json('PUT', '/api/simulations/' + sim.id + '/mask', { revision: sim.revision, png })),
  generateBatch: (sim: Simulation, requestId: string, section: StudioSection = 'brackets') =>
    read<{ simulation: Simulation; batchId: string; reused: boolean }>(
      json('POST', '/api/simulations/' + sim.id + '/batch', { revision: sim.revision, requestId, notes: '', section })),
  generate: (sim: Simulation, stage: StageKey, notes: string, requestId: string) =>
    read<{ simulation: Simulation; attemptId: string; reused: boolean }>(
      json('POST', '/api/simulations/' + sim.id + '/stages/' + stage + '/generate',
        { revision: sim.revision, requestId, notes })),
  review: (sim: Simulation, stage: StageKey, decision: 'accept' | 'reject') =>
    read<Simulation>(json('POST', '/api/simulations/' + sim.id + '/stages/' + stage + '/review',
      { revision: sim.revision, attemptId: sim.stages[stage].attemptId, decision })),
  remove: async (sim: Simulation) => {
    const response = await fetch('/api/simulations/' + sim.id + '?revision=' + sim.revision, { method: 'DELETE' });
    if (!response.ok) await read<unknown>(response);
  },
};
export async function uploadPhoto(file: File, onProgress: (value: number) => void, signal: AbortSignal): Promise<Simulation> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Selecciona una fotografía JPEG o PNG.');
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('El archivo debe medir entre 1 byte y 20 MB.');
  return new Promise<Simulation>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    request.open('POST', '/api/simulations');
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error('No se pudo conectar con el servidor local. Revisa que esté iniciado.'));
    request.onabort = () => reject(new Error('Carga cancelada. La fotografía original no se modificó.'));
    request.onload = () => {
      signal.removeEventListener('abort', abort);
      let body: unknown;
      try { body = JSON.parse(request.responseText) as unknown; } catch { body = {}; }
      if (request.status >= 200 && request.status < 300) resolve(body as Simulation);
      else {
        const error = body as { code?: string; error?: string };
        reject(new ApiError(request.status, error.code ?? 'UPLOAD_FAILED', error.error ?? 'No se pudo cargar la fotografía.'));
      }
    };
    const form = new FormData();
    form.append('file', file);
    request.send(form);
    if (signal.aborted) abort();
  });
}
