import OpenAI, { toFile } from 'openai';
import { AppError } from './errors.js';
import { prepareOpenAIEdit } from './images.js';
import { packReferences } from './provider.js';
import type { GenerationInput, GenerationResult, ImageProvider, ProviderImage } from './provider.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export interface OpenAIEditRequest {
  model: string;
  image: Array<Awaited<ReturnType<typeof toFile>>>;
  mask: Awaited<ReturnType<typeof toFile>>;
  prompt: string;
  n: 1;
  size: '1024x1024';
  quality: 'high';
  output_format: 'png';
  background: 'opaque';
}
type EditCall = (request: OpenAIEditRequest, options: { signal: AbortSignal; maxRetries: number; timeout: number }) => Promise<unknown>;

export function parseOpenAIImage(value: unknown): GenerationResult {
  const response = value as { data?: Array<{ b64_json?: string }>; usage?: Record<string, unknown> } | null;
  if (!response || !Array.isArray(response.data) || response.data.length !== 1)
    throw new AppError(422, 'NO_SINGLE_IMAGE', 'OpenAI no devolvió una única imagen utilizable. Revisa el intento antes de regenerar.');
  const data = response.data[0]?.b64_json;
  if (typeof data !== 'string' || !data || data.length > 80 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(data))
    throw new AppError(422, 'INVALID_IMAGE_DATA', 'OpenAI devolvió datos de imagen inválidos.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new AppError(422, 'INVALID_IMAGE_TYPE', 'OpenAI no devolvió el PNG solicitado.');
  const usage: Record<string, number> = {};
  for (const [key, amount] of Object.entries(response.usage ?? {}))
    if (typeof amount === 'number' && Number.isFinite(amount)) usage[key] = amount;
  return { bytes, mime: 'image/png', usage };
}

export class OpenAIProvider implements ImageProvider {
  readonly mode = 'openai' as const;
  readonly ready: boolean;
  private edit?: EditCall;
  constructor(key: string | undefined, edit?: EditCall) {
    this.ready = Boolean(key?.trim());
    if (this.ready) {
      if (edit) this.edit = edit;
      else {
        const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 300_000 });
        this.edit = (request, options) => client.images.edit(request, options);
      }
    }
  }
  async generate(input: GenerationInput): Promise<GenerationResult> {
    if (!this.edit) throw new AppError(503, 'MISSING_KEY', 'Configura OPENAI_API_KEY en .env.local o .env y reinicia el servidor.');
    if (!input.editMask || input.images.length < 2)
      throw new AppError(422, 'INVALID_REFERENCES', 'Faltan la máscara, el recorte o la fotografía original.');
    try {
      const [original, crop, ...references] = input.images;
      const edit = await prepareOpenAIEdit(crop!.bytes, input.editMask.bytes, input.editMask.bounds);
      const supporting = await packReferences([original!, ...references], 10 * 1024 * 1024, 'OpenAI');
      const ordered: ProviderImage[] = [
        { role: crop!.role, bytes: edit.image, mime: 'image/png' },
        ...supporting,
      ];
      const files = await Promise.all(ordered.map((image, index) => toFile(
        image.bytes, `reference-${index + 1}.${image.mime === 'image/jpeg' ? 'jpg' : 'png'}`, { type: image.mime },
      )));
      const mask = await toFile(edit.mask, 'dental-mask.png', { type: 'image/png' });
      const labels = ordered.map((image, index) => `IMAGE ${index + 1}: ${image.role}`).join('\n');
      const response = await this.edit({
        model: input.model,
        image: files,
        mask,
        prompt: `${labels}\nEdit IMAGE 1 only. Its transparent mask area identifies the dental region. IMAGE 2 is the mandatory full patient identity reference.\n${input.prompt}`,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
        background: 'opaque',
      }, { signal: input.signal, maxRetries: 0, timeout: 300_000 });
      return parseOpenAIImage(response);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const record = typeof error === 'object' && error !== null ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
      const status = Number(record.status);
      if (status === 401 || status === 403)
        throw new AppError(502, 'PROVIDER_AUTH', 'OpenAI rechazó la clave o el acceso al modelo. Revisa OPENAI_API_KEY y los permisos de la cuenta API.');
      if (status === 429)
        throw new AppError(429, 'PROVIDER_QUOTA', 'OpenAI indicó un límite de cuota. Revisa la cuenta API antes de reintentar.');
      if (record.code === 'moderation_blocked')
        throw new AppError(422, 'PROVIDER_REJECTED', 'OpenAI rechazó la generación. Revisa el intento antes de solicitar otra.');
      if (status === 400 || status === 404)
        throw new AppError(502, 'PROVIDER_REQUEST', 'OpenAI no aceptó la petición o el modelo configurado. Revisa su disponibilidad para tu cuenta API.');
      if (input.signal.aborted || record.name === 'APIConnectionTimeoutError' || record.name === 'AbortError')
        throw new AppError(504, 'PROVIDER_TIMEOUT', 'La espera se interrumpió. OpenAI pudo procesar la solicitud; no se repetirá automáticamente.');
      throw new AppError(502, 'PROVIDER_UNCERTAIN', 'No se pudo confirmar la respuesta de OpenAI. El proveedor pudo procesar la petición; revisa antes de reintentar.');
    }
  }
}
