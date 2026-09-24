import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeDental, hash, inspectVisualCandidate, normalizeOriginal, prepareMask, extractCrop, verifyExterior } from '../server/images.js';
import { mask, photo } from './helpers.js';

describe('composición localizada', () => {
  it('preserva exactamente los píxeles exteriores incluso si Gemini cambia todo el recorte', async () => {
    const original = await photo(), prepared = await prepareMask(await mask(), 120, 90);
    const candidate = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#ffaaaa' } }).png().toBuffer();
    const result = await composeDental(original, prepared.png, candidate, prepared.bounds);
    expect(result.quality.outsideChangedPixels).toBe(0);
    expect(result.quality.editedPixels).toBeGreaterThan(0);
    expect(await verifyExterior(original, prepared.png, result.png)).toEqual({ width: 120, height: 90, outsideChangedPixels: 0 });
    expect(hash(original)).toBe(hash(await photo()));
  });
  it('normaliza EXIF sin cambiar el original', async () => {
    const original = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const before = hash(original), result = await normalizeOriginal(original);
    expect([result.width, result.height]).toEqual([80, 120]);
    expect(hash(original)).toBe(before);
    expect((await sharp(result.data).metadata()).orientation).toBeUndefined();
  });
  it('rechaza máscara vacía, dimensiones equivocadas y selección excesiva', async () => {
    const blank = await sharp({ create: { width: 120, height: 90, channels: 3, background: 'black' } }).png().toBuffer();
    await expect(prepareMask(blank, 120, 90)).rejects.toMatchObject({ code: 'EMPTY_MASK' });
    await expect(prepareMask(blank, 10, 10)).rejects.toMatchObject({ code: 'INVALID_MASK' });
    const white = await sharp(blank).negate().png().toBuffer();
    await expect(prepareMask(white, 120, 90)).rejects.toMatchObject({ code: 'MASK_TOO_LARGE' });
  });
  it('admite selección junto al borde sin desplazar el lienzo original', async () => {
    const pixels = Buffer.alloc(120 * 90);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) pixels[y * 120 + x] = 255;
    const png = await sharp(pixels, { raw: { width: 120, height: 90, channels: 1 } }).png().toBuffer();
    const selected = await prepareMask(png, 120, 90);
    expect(selected.bounds.left).toBeLessThan(0);
    const crop = await extractCrop(await photo(), selected.bounds);
    expect((await sharp(crop).metadata()).width).toBe(selected.bounds.width);
    const output = await composeDental(await photo(), selected.png, await sharp(crop).negate().png().toBuffer(), selected.bounds);
    expect(output.quality.outsideChangedPixels).toBe(0);
  });
  it('no estira un candidato con proporción incorrecta', async () => {
    const selected = await prepareMask(await mask(), 120, 90);
    await expect(composeDental(await photo(), selected.png, await photo(), selected.bounds)).rejects.toMatchObject({ code: 'CROP_MISMATCH' });
  });
  it('acepta un retoque mínimo y aparta dentadura recreada o borde de boca alterado', async () => {
    const original = await photo(), selection = await prepareMask(await mask(), 120, 90);
    const crop = await extractCrop(original, selection.bounds);
    const base = await sharp(crop).removeAlpha().raw().toBuffer();
    const side = selection.bounds.width;
    const subtle = Buffer.from(base);
    for (let y = Math.floor(side / 2); y <= Math.floor(side / 2) + 1; y++)
      for (let x = Math.floor(side / 2) - 5; x <= Math.floor(side / 2) + 5; x++) {
        const i = (y * side + x) * 3;
        subtle[i] = 170; subtle[i + 1] = 175; subtle[i + 2] = 180;
      }
    const image = (data: Buffer) => sharp(data, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();
    const good = await inspectVisualCandidate(original, selection.png, await image(subtle), selection.bounds);
    expect(good.passed).toBe(true);
    const recreated = Buffer.from(base);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const sx = x + selection.bounds.left, sy = y + selection.bounds.top;
      if (sx < 0 || sy < 0 || sx >= 120 || sy >= 90 ||
        sy < 36 || sy >= 54 || sx < 36 || sx >= 84) continue;
      const i = (y * side + x) * 3;
      recreated[i] = 235; recreated[i + 1] = 180; recreated[i + 2] = 120;
    }
    const badTeeth = await inspectVisualCandidate(original, selection.png, await image(recreated), selection.bounds);
    expect(badTeeth).toMatchObject({ passed: false, reason: 'DENTAL_DRIFT' });
    const badContext = await inspectVisualCandidate(original, selection.png,
      await sharp({ create: { width: side, height: side, channels: 3, background: '#ffffff' } }).png().toBuffer(), selection.bounds);
    expect(badContext).toMatchObject({ passed: false, reason: 'CONTEXT_DRIFT' });
  });
  it('rechaza datos corruptos y detecta un exterior alterado', async () => {
    await expect(normalizeOriginal(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const changed = await sharp(await photo()).negate().png().toBuffer();
    expect((await verifyExterior(await photo(), await mask(), changed)).outsideChangedPixels).toBeGreaterThan(0);
  });
});
