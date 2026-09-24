import { expect, it } from 'vitest';
import sharp from 'sharp';
import { extractCrop, prepareMask, prepareOpenAIEdit } from '../server/images.js';
import { OpenAIProvider, parseOpenAIImage } from '../server/openai-provider.js';
import type { OpenAIEditRequest } from '../server/openai-provider.js';
import { mask, photo } from './helpers.js';

it('convierte la selección dental en transparencia solo dentro del recorte', async () => {
  const prepared = await prepareMask(await mask(), 120, 90);
  const edit = await prepareOpenAIEdit(await extractCrop(await photo(), prepared.bounds), prepared.png, prepared.bounds);
  const imageMeta = await sharp(edit.image).metadata(), maskMeta = await sharp(edit.mask).metadata();
  expect([imageMeta.width, imageMeta.height, imageMeta.format]).toEqual([edit.size, edit.size, 'png']);
  expect([maskMeta.width, maskMeta.height, maskMeta.channels]).toEqual([edit.size, edit.size, 4]);
  const alpha = await sharp(edit.mask).ensureAlpha().extractChannel(3).raw().toBuffer();
  expect(alpha.includes(0)).toBe(true);
  expect(alpha.includes(255)).toBe(true);
  expect(edit.size).toBe(1024);
  const x = Math.floor((60 - prepared.bounds.left + .5) * edit.size / prepared.bounds.width);
  const y = Math.floor((45 - prepared.bounds.top + .5) * edit.size / prepared.bounds.height);
  expect(alpha[y * edit.size + x]).toBe(0);
  expect(alpha[0]).toBe(255);
  expect(edit.mask.length).toBeLessThan(4 * 1024 * 1024);
});

it('envía recorte primero, fotografía original después y una máscara compatible, sin reintentos', async () => {
  const original = await photo(), selected = await prepareMask(await mask(), 120, 90);
  const crop = await extractCrop(original, selected.bounds);
  const resultImage = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'white' } }).png().toBuffer();
  let request: OpenAIEditRequest | undefined;
  let retryCount = -1;
  const provider = new OpenAIProvider('test-key', async (body, options) => {
    request = body; retryCount = options.maxRetries;
    return { data: [{ b64_json: resultImage.toString('base64') }], usage: { total_tokens: 24 } };
  });
  const result = await provider.generate({
    model: 'gpt-image-2.5-sunburst', prompt: 'Keep the same patient teeth.', signal: new AbortController().signal,
    images: [
      { role: 'ORIGINAL PATIENT PHOTO', bytes: original, mime: 'image/png' },
      { role: 'WORK CROP', bytes: crop, mime: 'image/png' },
      { role: 'ACCEPTED FINAL DESTINATION', bytes: crop, mime: 'image/png' },
    ],
    editMask: { bytes: selected.png, bounds: selected.bounds },
  });
  expect(request?.model).toBe('gpt-image-2.5-sunburst');
  expect(request?.image).toHaveLength(3);
  expect(request?.prompt).toContain('IMAGE 1: WORK CROP');
  expect(request?.prompt).toContain('IMAGE 2: ORIGINAL PATIENT PHOTO');
  expect(request?.prompt).toContain('IMAGE 3: ACCEPTED FINAL DESTINATION');
  expect(request?.output_format).toBe('png');
  expect(retryCount).toBe(0);
  const first = Buffer.from(await request!.image[0]!.arrayBuffer());
  const maskBytes = Buffer.from(await request!.mask.arrayBuffer());
  expect((await sharp(first).metadata()).width).toBe((await sharp(maskBytes).metadata()).width);
  expect(result.bytes).toEqual(resultImage);
  expect(result.usage).toEqual({ total_tokens: 24 });
});

it('rechaza salidas vacías o ajenas a PNG sin tratarlas como resultados', () => {
  expect(() => parseOpenAIImage({ data: [] })).toThrow();
  expect(() => parseOpenAIImage({ data: [{ b64_json: '%' }] })).toThrow();
  expect(() => parseOpenAIImage({ data: [{ b64_json: Buffer.from('not png').toString('base64') }] })).toThrow();
});
