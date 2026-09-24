import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import type { Simulation } from '../../shared/domain.js';
import { STAGES, STAGE_INFO } from '../../shared/domain.js';

async function createAndMask(page: import('@playwright/test').Page, name: string) {
  const buffer = await sharp({ create: { width: 420, height: 280, channels: 3, background: '#8da5a8' } }).png().toBuffer();
  await page.goto('/');
  await page.getByLabel('Seleccionar fotografía').setInputFiles({ name, mimeType: 'image/png', buffer });
  await page.getByRole('button', { name: 'Crear simulación' }).click();
  await expect(page.getByRole('heading', { name: 'Marca solo la zona dental' })).toBeVisible();
  await page.getByText('Alternativa sin arrastrar: marcar por coordenadas').click();
  await page.getByLabel('Posición X').fill('150');
  await page.getByLabel('Posición Y').fill('120');
  await page.getByLabel('Ancho').fill('100');
  await page.getByLabel('Alto').fill('40');
  await page.getByRole('button', { name: 'Marcar rectángulo' }).click();
  await expect(page.getByText('Selección sin guardar', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar región dental' }).click();
  await expect(page.getByRole('heading', { name: 'Una evolución, tres fotografías' })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('sim');
  expect(id).toBeTruthy();
  return id!;
}

test.beforeEach(async ({ request }) => {
  await request.post('/__test/provider', { data: { fail: false } });
});

test('la interfaz se recupera cuando la API tarda en estar disponible al abrir', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/health', async (route) => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('La API local está iniciando o reiniciando. Reconectando automáticamente…')).toBeVisible();
  await expect(page.getByText('Proveedor de prueba')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('La API local está iniciando o reiniciando. Reconectando automáticamente…')).toBeHidden();
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test('flujo completo: original, máscara, revisión, tres fotografías y eliminación', async ({ page, request }, testInfo) => {
  const id = await createAndMask(page, 'flujo-' + Date.now() + '.png');
  await expect(page.getByRole('button', { name: 'Generar las 3 imágenes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).click();
  await expect.poll(async () => (await (await request.get('/__test/provider')).json() as { active: number }).active).toBe(3);
  await page.reload();
  await expect.poll(async () => {
    const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
    return STAGES.map((key) => sim.stages[key].status);
  }, { timeout: 30_000 }).toEqual(['needs_review', 'needs_review', 'needs_review']);
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole('heading', { name: STAGE_INFO[STAGES[i]!].label, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Aceptar y revisar siguiente' }).click();
    await expect.poll(async () => {
      const current = await (await request.get('/api/simulations/' + id)).json() as Simulation;
      return current.stages[STAGES[i]!].status;
    }).toBe('accepted');
    await expect(page.getByRole('heading', { name: STAGE_INFO[STAGES[i + 1]!].label, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Aceptar etapa' }).click();
  await expect(page.getByRole('heading', { name: 'Las tres etapas están listas' })).toBeVisible();
  const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
  expect((await (await request.get('/__test/provider')).json() as { maxActive: number }).maxActive).toBe(3);
  expect(sim.assets.find((asset) => asset.id === sim.originalAssetId)?.kind).toBe('original');
  for (const key of STAGES) {
    expect(sim.stages[key].status).toBe('accepted');
    expect(sim.stages[key].quality?.outsideChangedPixels).toBe(0);
    const output = await request.get('/api/simulations/' + id + '/assets/' + sim.stages[key].outputAssetId + '?download=1');
    expect(output.status()).toBe(200);
    expect(output.headers()['content-disposition']).toContain(STAGE_INFO[key].filename);
    expect((await sharp(await output.body()).metadata()).width).toBe(420);
  }
  await page.screenshot({ path: testInfo.outputPath('full-workflow.png'), fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('heading', { name: 'Eliminar simulación' })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar simulación' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza con la fotografía original.' })).toBeVisible();
  expect((await request.get('/api/simulations/' + id)).status()).toBe(404);
});

test('edita y conserva prompts; cada generación recibe el texto previsualizado', async ({ page, request }, testInfo) => {
  const id = await createAndMask(page, 'prompts-' + Date.now() + '.png');
  await page.getByRole('button', { name: 'Editar prompts' }).click();
  await expect(page.getByRole('heading', { name: 'Editar prompts' })).toBeVisible();
  await expect(page.getByLabel('Instrucciones comunes')).toBeFocused();
  await expect(page.getByLabel('Instrucciones comunes')).toContainText('Retain each original tooth');
  await page.getByLabel('Instrucciones comunes').fill('KEEP THE PATIENT IDENTITY AND TEETH.');
  await page.getByLabel('18 meses').fill('AT EIGHTEEN MONTHS KEEP SOME ORIGINAL IRREGULARITY AND SMALL BRACKETS.');
  await page.getByRole('button', { name: '18 meses' }).click();
  await expect(page.locator('.prompt-editor__preview pre')).toContainText('AT EIGHTEEN MONTHS KEEP SOME ORIGINAL IRREGULARITY');
  await page.screenshot({ path: testInfo.outputPath('prompt-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nueva simulación' }).click();
  await expect(page.getByRole('heading', { name: 'Tienes una selección sin guardar' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir editando' }).click();
  await page.getByRole('button', { name: 'Guardar prompts' }).click();
  await expect(page.getByRole('heading', { name: 'Una evolución, tres fotografías' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Editar prompts' }).click();
  await expect(page.getByLabel('Instrucciones comunes')).toHaveValue('KEEP THE PATIENT IDENTITY AND TEETH.');
  await page.getByRole('button', { name: 'Volver sin guardar' }).click();
  await expect(page.getByRole('button', { name: 'Editar prompts' })).toBeFocused();
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).click();
  await expect.poll(async () => {
    const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
    return STAGES.map((key) => sim.stages[key].status);
  }, { timeout: 30_000 }).toEqual(['needs_review', 'needs_review', 'needs_review']);
  const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
  expect(sim.promptRevision).toBe(1);
  expect(sim.attempts).toHaveLength(3);
  expect(sim.attempts[1]?.promptText).toContain('AT EIGHTEEN MONTHS KEEP SOME ORIGINAL IRREGULARITY');
  expect(sim.attempts.every((attempt) => attempt.promptText?.includes('KEEP THE PATIENT IDENTITY AND TEETH.'))).toBe(true);
});

test('una foto pequeña se amplía para marcar con pincel fino sin cambiar sus coordenadas', async ({ page, request }, testInfo) => {
  const buffer = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#8da5a8' } }).png().toBuffer();
  await page.goto('/');
  await page.getByLabel('Seleccionar fotografía').setInputFiles({ name: 'pequena.png', mimeType: 'image/png', buffer });
  await page.getByRole('button', { name: 'Crear simulación' }).click();
  await expect(page.getByLabel('Tamaño del pincel')).toHaveValue('2');
  const canvas = page.getByLabel('Dibuja sobre la región dental; alternativa numérica debajo');
  await expect(canvas).toBeVisible();
  const initial = (await canvas.boundingBox())!;
  expect(initial.width).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Acercar imagen' }).click();
  await page.locator('.mask-editor__viewport').evaluate((element) => { element.scrollTop = 180; });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * .5, y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await expect(page.locator('.mask-editor__brush-preview')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('small-photo-mask.png'), fullPage: true });
  await page.mouse.down();
  await page.mouse.move(x + box.width * .03, y, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Confirmar región dental' }).click();
  await expect(page.getByRole('heading', { name: 'Una evolución, tres fotografías' })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('sim')!;
  const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
  const saved = await request.get('/api/simulations/' + id + '/assets/' + sim.maskAssetId);
  const { data, info } = await sharp(await saved.body()).greyscale().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([200, 300]);
  const selected: Array<{ x: number; y: number }> = [];
  data.forEach((value, i) => { if (value === 255) selected.push({ x: i % 200, y: Math.floor(i / 200) }); });
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every(({ x, y }) => x >= 98 && x <= 108 && y >= 148 && y <= 152)).toBe(true);
});

test('cuota agotada registra tres fallos sin reintento automático y permite pedir otro', async ({ page, request }) => {
  const id = await createAndMask(page, 'fallo-' + Date.now() + '.png');
  await request.post('/__test/provider', { data: { fail: true } });
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Cuota de prueba agotada.' })).toBeVisible({ timeout: 30_000 });
  expect((await (await request.get('/__test/provider')).json() as { calls: number }).calls).toBe(3);
  await page.waitForTimeout(800);
  expect((await (await request.get('/__test/provider')).json() as { calls: number }).calls).toBe(3);
  await request.post('/__test/provider', { data: { fail: false } });
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).click();
  await expect(page.getByRole('heading', { name: 'Generar secuencia completa' })).toBeVisible();
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).last().click();
  await expect.poll(async () => {
    const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
    return STAGES.map((key) => sim.stages[key].status);
  }, { timeout: 30_000 }).toEqual(['needs_review', 'needs_review', 'needs_review']);
  const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
  expect(sim.attempts).toHaveLength(6);
  expect(sim.attempts[0]?.status).toBe('failed');
  expect(sim.attempts[3]?.status).toBe('needs_review');
});

test('aparta un resultado que redibuja toda la boca y mantiene disponible una regeneración individual', async ({ page, request }) => {
  const id = await createAndMask(page, 'desvio-' + Date.now() + '.png');
  await request.post('/__test/provider', { data: { overpaint: true } });
  await page.getByRole('button', { name: 'Generar las 3 imágenes' }).click();
  await expect.poll(async () => {
    const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
    return STAGES.map((key) => sim.stages[key].status);
  }, { timeout: 30_000 }).toEqual(['failed', 'failed', 'failed']);
  const sim = await (await request.get('/api/simulations/' + id)).json() as Simulation;
  expect(sim.stages.month_6.outputAssetId).toBeUndefined();
  expect(sim.attempts.every((attempt) => attempt.errorCode === 'VISUAL_CONTEXT_DRIFT' && attempt.candidateAssetId)).toBe(true);
  await expect(page.locator('.timeline-card__text small').filter({ hasText: 'Apartado por control visual' })).toHaveCount(3);
  await expect(page.getByRole('alert').filter({ hasText: 'El proveedor cambió demasiado el borde de la boca.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Regenerar esta etapa' })).toBeEnabled();
  await page.getByText('Historial de intentos · 3').click();
  await expect(page.getByRole('link', { name: 'Ver recorte apartado' })).toHaveCount(3);
});

test('la selección sin guardar se protege al navegar y la pantalla cabe en móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createAndMask(page, 'movil-' + Date.now() + '.png');
  await page.getByRole('button', { name: 'Ajustar región' }).click();
  await expect(page.getByRole('heading', { name: 'Marca solo la zona dental' })).toBeVisible();
  await page.getByText('Alternativa sin arrastrar: marcar por coordenadas').click();
  await page.getByRole('button', { name: 'Marcar rectángulo' }).click();
  await page.getByRole('button', { name: 'Nueva simulación' }).click();
  await expect(page.getByRole('heading', { name: 'Tienes una selección sin guardar' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page.getByRole('heading', { name: 'Marca solo la zona dental' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.getByRole('button', { name: 'Confirmar región dental' }).click();
  await expect(page.getByRole('heading', { name: 'Una evolución, tres fotografías' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar prompts' }).click();
  await expect(page.getByRole('heading', { name: 'Editar prompts' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.getByRole('button', { name: 'Volver sin guardar' }).click();
  await page.getByRole('button', { name: 'Nueva simulación' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza con la fotografía original.' })).toBeVisible();
});
