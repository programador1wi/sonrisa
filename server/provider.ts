import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { AppError } from './errors.js';
import type { Bounds, ProviderMode } from '../shared/domain.js';
export interface ProviderImage { role: string; bytes: Buffer; mime: 'image/png' | 'image/jpeg' }
export interface GenerationInput { model: string; prompt: string; images: ProviderImage[]; signal: AbortSignal; editMask?: { bytes: Buffer; bounds: Bounds } }
export interface GenerationResult { bytes: Buffer; mime: 'image/png' | 'image/jpeg'; usage: Record<string, number> }
export interface ImageProvider {
  readonly mode: ProviderMode;
  readonly ready: boolean;
  generate(input: GenerationInput): Promise<GenerationResult>;
}

// Three references capped at 3 MB each stay under Gemini's 20 MB inline JSON
// request limit after base64 encoding, leaving room for prompts and metadata.
export async function packReferences(images: ProviderImage[], maxBytes = 3 * 1024 * 1024, provider = 'Gemini'): Promise<ProviderImage[]> {
  return Promise.all(images.map(async (image) => {
    if (image.bytes.length <= maxBytes) return image;
    for (const quality of [90, 80, 70]) {
      const bytes = await sharp(image.bytes, { limitInputPixels: 40_000_000 })
        .autoOrient().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
      if (bytes.length <= maxBytes) return { ...image, bytes, mime: 'image/jpeg' as const };
    }
    throw new AppError(422, 'INPUT_TOO_LARGE', `Las referencias superan el tamaño admitido por ${provider}. Usa una fotografía con menos detalle o peso.`);
  }));
}

export class GeminiProvider implements ImageProvider {
  readonly mode = 'gemini' as const;
  readonly ready: boolean;
  private client?: GoogleGenAI;
  constructor(key: string | undefined) {
    this.ready = Boolean(key?.trim());
    if (this.ready) this.client = new GoogleGenAI({ apiKey: key });
  }
  async generate(input: GenerationInput): Promise<GenerationResult> {
    if (!this.client) throw new AppError(503, 'MISSING_KEY', 'Configura GEMINI_API_KEY en .env.local o .env y reinicia el servidor.');
    try {
      const images = await packReferences(input.images);
      const response = await this.client.interactions.create({
        model: input.model,
        input: [
          { type: 'text', text: input.prompt },
          ...images.flatMap((image) => [
            { type: 'text' as const, text: image.role },
            { type: 'image' as const, data: image.bytes.toString('base64'), mime_type: image.mime },
          ]),
        ],
        store: false,
        response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '1:1', image_size: '2K' },
      }, { signal: input.signal, maxRetries: 0, timeout: 300_000 });
      return parseGeneration(response);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
      if (status === 401 || status === 403) throw new AppError(502, 'PROVIDER_AUTH', 'Gemini rechazó las credenciales o el acceso al modelo. Revisa la clave y los permisos.');
      if (status === 429) throw new AppError(429, 'PROVIDER_QUOTA', 'Gemini indicó un límite de cuota. Revisa tu cuota antes de reintentar.');
      if (status === 400 || status === 404) throw new AppError(502, 'PROVIDER_REQUEST', 'Gemini no aceptó la petición o el modelo configurado. Revisa la disponibilidad del modelo en tu proyecto.');
      if (input.signal.aborted) throw new AppError(504, 'PROVIDER_TIMEOUT', 'Se agotó el tiempo de espera. El resultado del proveedor es desconocido; no se reintentará automáticamente.');
      throw new AppError(502, 'PROVIDER_UNCERTAIN', 'No se pudo confirmar la respuesta de Gemini. El proveedor pudo procesar la petición; revisa antes de reintentar.');
    }
  }
}

// Parse untrusted multimodal responses separately from the SDK; never log their contents.
export function parseGeneration(value: unknown): GenerationResult {
  const object = (v: unknown): Record<string, unknown> | undefined => typeof v === 'object' && v !== null ? v as Record<string, unknown> : undefined;
  const response = object(value);
  if (['failed', 'cancelled', 'budget_exceeded'].includes(String(response?.status)))
    throw new AppError(502, 'PROVIDER_REJECTED', 'Gemini rechazó o canceló la generación. Revisa el intento antes de solicitar otra.');
  const images: Record<string, unknown>[] = [];
  // The SDK exposes the final generated image here. A model may also emit
  // intermediate image blocks in steps; those are not additional deliverables.
  const finalImage = object(response?.output_image);
  if (finalImage && typeof finalImage.data === 'string') images.push(finalImage);
  const collect = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const block = object(item);
      if (block?.type === 'image' && typeof block.data === 'string') images.push(block);
    }
  };
  if (!images.length && Array.isArray(response?.steps)) for (const step of response.steps) {
    const block = object(step);
    if (block?.type === 'model_output') collect(block.content);
  }
  // Earlier Interactions SDK versions expose final content under outputs.
  if (!images.length) collect(response?.outputs);
  if (images.length !== 1) throw new AppError(422, 'NO_SINGLE_IMAGE', 'Gemini no devolvió una única imagen utilizable. La etapa requiere otra generación.');
  const image = images[0]!;
  const data = String(image.data);
  if (!data || data.length > 80 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(data))
    throw new AppError(422, 'INVALID_IMAGE_DATA', 'Gemini devolvió datos de imagen inválidos.');
  const bytes = Buffer.from(data, 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const mime = image.mime_type ?? (png ? 'image/png' : jpeg ? 'image/jpeg' : undefined);
  if (mime !== 'image/png' && mime !== 'image/jpeg')
    throw new AppError(422, 'INVALID_IMAGE_TYPE', 'Gemini devolvió un formato de imagen incompatible.');
  const usage: Record<string, number> = {};
  for (const [key, val] of Object.entries(object(response?.usage) ?? {})) if (typeof val === 'number' && Number.isFinite(val)) usage[key] = val;
  return { bytes, mime, usage };
}
