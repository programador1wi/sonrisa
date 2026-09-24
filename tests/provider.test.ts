import { expect, it } from 'vitest';
import { packReferences, parseGeneration } from '../server/provider.js';
import sharp from 'sharp';

it('extrae una imagen final y consumo de Interactions, ignorando texto', () => {
  const response = parseGeneration({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'image', mime_type: 'image/png', data: Buffer.from('test').toString('base64') }] }], usage: { total_tokens: 12, other: 'not a number' } });
  expect(response.bytes.toString()).toBe('test');
  expect(response.usage).toEqual({ total_tokens: 12 });
});
it('prefiere output_image del SDK sobre imágenes intermedias de steps', () => {
  const final = Buffer.from('final').toString('base64');
  const response = parseGeneration({
    output_image: { type: 'image', mime_type: 'image/png', data: final },
    steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: Buffer.from('draft').toString('base64') }] }],
  });
  expect(response.bytes.toString()).toBe('final');
});
it('acepta el PNG final cuando el SDK omite mime_type y distingue un rechazo', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  const result = parseGeneration({ status: 'completed', output_image: { type: 'image', data: png.toString('base64') } });
  expect(result.mime).toBe('image/png');
  expect(result.bytes).toEqual(png);
  expect(() => parseGeneration({ status: 'failed', output_image: { type: 'image', data: png.toString('base64') } })).toThrow();
});
it('rechaza respuesta sin imagen, múltiples imágenes y datos inválidos', () => {
  expect(() => parseGeneration({ outputs: [{ type: 'text', text: 'blocked' }] })).toThrow();
  const image = { type: 'image', mime_type: 'image/png', data: 'YWJj' };
  expect(() => parseGeneration({ outputs: [image, image] })).toThrow();
  expect(() => parseGeneration({ outputs: [{ ...image, data: '%' }] })).toThrow();
});
it('mantiene referencias pequeñas y reduce imágenes grandes sin tocar sus bytes originales', async () => {
  const tiny = Buffer.from('image');
  const large = await sharp({ create: { width: 1200, height: 1000, channels: 3, background: '#a55c30' } })
    .png({ compressionLevel: 0 }).toBuffer();
  const original = Buffer.from(large);
  const result = await packReferences([
    { role: 'ORIGINAL', bytes: large, mime: 'image/png' },
    { role: 'WORK', bytes: tiny, mime: 'image/png' },
  ]);
  expect(result[0]?.mime).toBe('image/jpeg');
  expect(result[0]?.bytes.length).toBeLessThanOrEqual(3 * 1024 * 1024);
  expect(result[1]?.bytes).toBe(tiny);
  expect(large.equals(original)).toBe(true);
});
