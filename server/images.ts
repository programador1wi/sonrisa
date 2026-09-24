import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { Bounds, QualityReport, VisualCheck } from '../shared/domain.js';
import { AppError } from './errors.js';

const MAX_PIXELS = 40_000_000;
const decode = (input: Buffer) => sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
export const hash = (input: Buffer) => createHash('sha256').update(input).digest('hex');

export async function normalizeOriginal(input: Buffer) {
  try {
    const meta = await decode(input).metadata();
    if (!['jpeg', 'png'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1)
      throw new AppError(400, 'INVALID_IMAGE', 'Selecciona una fotografía JPEG o PNG de una sola imagen.');
    const { data, info } = await decode(input).autoOrient().toColourspace('srgb').removeAlpha().png().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, mime: meta.format === 'jpeg' ? 'image/jpeg' as const : 'image/png' as const };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_IMAGE', 'No se pudo leer la fotografía. Usa JPEG o PNG, hasta 20 MB y 40 megapíxeles.');
  }
}

export async function prepareMask(input: Buffer, width: number, height: number) {
  let pixels: Buffer;
  try {
    const meta = await decode(input).metadata();
    if (meta.format !== 'png' || meta.width !== width || meta.height !== height || (meta.pages ?? 1) !== 1)
      throw new Error('dimensions');
    // The editor exports opaque black/white PNG. Transparency never expands the editable area.
    pixels = await decode(input).flatten({ background: '#000000' }).greyscale().raw().toBuffer();
  } catch {
    throw new AppError(400, 'INVALID_MASK', 'La máscara debe ser un PNG con las dimensiones exactas de la fotografía.');
  }
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const selected = (pixels[i] ?? 0) >= 128;
    pixels[i] = selected ? 255 : 0;
    if (selected) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++; }
  }
  if (count === 0) throw new AppError(400, 'EMPTY_MASK', 'Marca primero la región dental que deseas editar.');
  if (count > width * height * 0.4) throw new AppError(400, 'MASK_TOO_LARGE', 'La selección ocupa demasiado de la fotografía. Limítala a la región dental.');
  // Square crop is a supported provider aspect ratio. Padding is input context only, never output framing.
  const size = Math.max(32, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 1.5));
  const bounds: Bounds = {
    left: Math.round((left + right + 1 - size) / 2),
    top: Math.round((top + bottom + 1 - size) / 2), width: size, height: size,
  };
  const png = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { png, bounds };
}

export async function extractCrop(original: Buffer, bounds: Bounds): Promise<Buffer> {
  const { width = 0, height = 0 } = await decode(original).metadata();
  const left = Math.max(0, -bounds.left), top = Math.max(0, -bounds.top);
  const right = Math.max(0, bounds.left + bounds.width - width), bottom = Math.max(0, bounds.top + bounds.height - height);
  const padded = await decode(original).extend({ left, top, right, bottom, extendWith: 'copy' }).png().toBuffer();
  return decode(padded).extract({ left: bounds.left + left, top: bounds.top + top, width: bounds.width, height: bounds.height }).png().toBuffer();
}

// OpenAI applies the alpha mask to its first input image. The first image is
// always the square work crop; transparent mask pixels correspond to teeth.
export async function prepareOpenAIEdit(crop: Buffer, mask: Buffer, bounds: Bounds) {
  if (bounds.width !== bounds.height || bounds.width < 1)
    throw new AppError(422, 'INVALID_GEOMETRY', 'El recorte dental debe ser cuadrado.');
  const { data: selected, info } = await decode(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  // Match the requested output grid. A tiny edit image forces the provider to
  // invent most of the 1024-pixel dental crop while resizing its alpha mask.
  const target = 1024;
  const image = await decode(crop).autoOrient().toColourspace('srgb').removeAlpha()
    .resize(target, target, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const editPixels = Buffer.alloc(target * target * 4, 255);
  for (let y = 0; y < target; y++) for (let x = 0; x < target; x++) {
    const sourceX = bounds.left + Math.min(bounds.width - 1, Math.floor((x + 0.5) * bounds.width / target));
    const sourceY = bounds.top + Math.min(bounds.height - 1, Math.floor((y + 0.5) * bounds.height / target));
    const editable = sourceX >= 0 && sourceY >= 0 && sourceX < info.width && sourceY < info.height &&
      selected[sourceY * info.width + sourceX] === 255;
    editPixels[(y * target + x) * 4 + 3] = editable ? 0 : 255;
  }
  const editMask = await sharp(editPixels, { raw: { width: target, height: target, channels: 4 } }).png().toBuffer();
  if (editMask.length >= 4 * 1024 * 1024)
    throw new AppError(422, 'MASK_TOO_LARGE', 'La máscara dental supera el límite de OpenAI. Reduce o simplifica la región seleccionada.');
  return { image, mask: editMask, size: target };
}

// Conservative photographic checks. They do not identify teeth anatomically;
// they refuse large changes to source pixels or to the protected mouth border.
export async function inspectVisualCandidate(original: Buffer, mask: Buffer, candidate: Buffer, bounds: Bounds): Promise<VisualCheck> {
  const { width = 0, height = 0 } = await decode(candidate).metadata();
  if (!width || width !== height) throw new AppError(422, 'CROP_MISMATCH', 'El recorte generado cambió de proporción.');
  const base = await decode(await extractCrop(original, bounds)).removeAlpha().raw().toBuffer();
  const patch = await decode(candidate).toColourspace('srgb').removeAlpha()
    .resize(bounds.width, bounds.height, { fit: 'fill' }).raw().toBuffer();
  const fullMask = await decode(mask).greyscale().raw().toBuffer();
  const { width: imageWidth = 0, height: imageHeight = 0 } = await decode(original).metadata();
  if (fullMask.length !== imageWidth * imageHeight) throw new AppError(422, 'INVALID_GEOMETRY', 'La máscara no coincide con la fotografía.');
  const side = bounds.width;
  const selected = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sourceX = bounds.left + x, sourceY = bounds.top + y;
    if (sourceX >= 0 && sourceX < imageWidth && sourceY >= 0 && sourceY < imageHeight &&
      fullMask[sourceY * imageWidth + sourceX] === 255) selected[y * side + x] = 1;
  }
  const near = new Uint8Array(selected.length);
  const radius = 4;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    if (!selected[y * side + x]) continue;
    if (x >= radius && x + radius < side && y >= radius && y + radius < side &&
      selected[y * side + x - radius] && selected[y * side + x + radius] &&
      selected[(y - radius) * side + x] && selected[(y + radius) * side + x]) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      const row = y + dy;
      if (row < 0 || row >= side) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const col = x + dx;
        if (col >= 0 && col < side) near[row * side + col] = 1;
      }
    }
  }
  const dental = { count: 0, changed: 0, sum: 0 };
  const context = { count: 0, changed: 0, sum: 0 };
  for (let i = 0; i < selected.length; i++) {
    const area = selected[i] ? dental : near[i] ? context : undefined;
    if (!area) continue;
    const offset = i * 3;
    const delta = (Math.abs(base[offset]! - patch[offset]!) +
      Math.abs(base[offset + 1]! - patch[offset + 1]!) + Math.abs(base[offset + 2]! - patch[offset + 2]!)) / 3;
    area.count++;
    area.sum += delta;
    if (delta > 30) area.changed++;
  }
  if (!dental.count || !context.count) throw new AppError(422, 'INVALID_GEOMETRY', 'La región dental necesita un borde de referencia visible.');
  const dentalChangedPercent = Math.round(dental.changed / dental.count * 1000) / 10;
  const contextChangedPercent = Math.round(context.changed / context.count * 1000) / 10;
  const dentalMeanDelta = Math.round(dental.sum / dental.count * 10) / 10;
  const contextMeanDelta = Math.round(context.sum / context.count * 10) / 10;
  const contextDrift = contextChangedPercent > 25 && contextMeanDelta > 23;
  const dentalDrift = dentalChangedPercent > 45 && dentalMeanDelta > 35;
  return { version: 1, passed: !contextDrift && !dentalDrift,
    ...(contextDrift ? { reason: 'CONTEXT_DRIFT' as const } : dentalDrift ? { reason: 'DENTAL_DRIFT' as const } : {}),
    dentalChangedPercent, dentalMeanDelta, contextChangedPercent, contextMeanDelta };
}

export async function composeDental(original: Buffer, mask: Buffer, candidate: Buffer, bounds: Bounds) {
  let candidateMeta;
  try { candidateMeta = await decode(candidate).metadata(); } catch {
    throw new AppError(422, 'INVALID_CANDIDATE', 'El proveedor devolvió una imagen ilegible. Regenera esta etapa.');
  }
  if (!['jpeg', 'png'].includes(candidateMeta.format ?? '') || (candidateMeta.pages ?? 1) !== 1)
    throw new AppError(422, 'INVALID_CANDIDATE', 'El proveedor no devolvió una fotografía compatible.');
  const cw = candidateMeta.width ?? 0, ch = candidateMeta.height ?? 0;
  if (cw === 0 || ch === 0 || cw !== ch)
    throw new AppError(422, 'CROP_MISMATCH', 'El recorte generado cambió de proporción. Regenera sin cambiar el encuadre.');
  const { data: base, info } = await decode(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const selected = await decode(mask).greyscale().raw().toBuffer();
  const patch = await decode(candidate).toColourspace('srgb').removeAlpha().resize(bounds.width, bounds.height, { fit: 'fill' }).raw().toBuffer();
  if (selected.length !== info.width * info.height || info.channels !== 3)
    throw new AppError(422, 'INVALID_GEOMETRY', 'La máscara no coincide con la fotografía de trabajo.');
  const output = Buffer.from(base);
  let editedPixels = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const index = y * info.width + x;
    if (selected[index] !== 255) continue;
    const px = x - bounds.left, py = y - bounds.top;
    if (px < 0 || py < 0 || px >= bounds.width || py >= bounds.height)
      throw new AppError(422, 'INVALID_GEOMETRY', 'La selección queda fuera del recorte guardado.');
    // Feather just inside the selection. Pixels with mask=0 are never written.
    let edgeDistance = 3;
    for (let d = 1; d <= 2; d++) {
      if (x < d || y < d || x + d >= info.width || y + d >= info.height ||
        selected[index - d] === 0 || selected[index + d] === 0 ||
        selected[index - d * info.width] === 0 || selected[index + d * info.width] === 0) { edgeDistance = d; break; }
    }
    const alpha = edgeDistance / 3, patchIndex = (py * bounds.width + px) * 3;
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const i = index * 3 + c;
      output[i] = Math.round((base[i] ?? 0) * (1 - alpha) + (patch[patchIndex + c] ?? 0) * alpha);
      if (output[i] !== base[i]) changed = true;
    }
    if (changed) editedPixels++;
  }
  const png = await sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  // Verify the actual encoded deliverable, not just the intermediate buffer.
  const verification = await verifyExterior(original, mask, png);
  if (verification.outsideChangedPixels !== 0)
    throw new AppError(422, 'EXTERIOR_CHANGED', 'La validación detectó cambios fuera de la selección. La imagen no se guardó como resultado.');
  const quality: QualityReport = { ...verification, editedPixels, originalHashVerified: false };
  return { png, crop: await extractCrop(png, bounds), quality };
}

export async function verifyExterior(original: Buffer, mask: Buffer, output: Buffer) {
  const { data: before, info } = await decode(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: after, info: afterInfo } = await decode(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== afterInfo.width || info.height !== afterInfo.height || info.channels !== afterInfo.channels)
    throw new AppError(422, 'DIMENSIONS_CHANGED', 'Las dimensiones del resultado no coinciden con el original.');
  const selected = await decode(mask).greyscale().raw().toBuffer();
  let outsideChangedPixels = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    if (selected[i] !== 0) continue;
    for (let c = 0; c < info.channels; c++) {
      if (before[i * info.channels + c] !== after[i * info.channels + c]) { outsideChangedPixels++; break; }
    }
  }
  return { outsideChangedPixels, width: info.width, height: info.height };
}
