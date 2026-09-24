import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { hash, verifyExterior } from '../server/images.js';
import { STAGES } from '../shared/domain.js';

config({ path: '.env.local', quiet: true });
const store = await Store.open(resolve(process.env.SONRISA_DATA_DIR ?? './data'));
try {
  const sims = store.all().filter((sim) => STAGES.every((key) => sim.stages[key].status === 'accepted'));
  if (sims.length < 5) throw new Error('Se requieren al menos cinco simulaciones reales completas y aceptadas. Disponibles: ' + sims.length);
  for (const sim of sims) {
    const original = await store.read(sim, sim.originalAssetId);
    if (hash(original) !== sim.originalHash) throw new Error('El original cambió en ' + sim.id);
    const working = await store.read(sim, sim.workingAssetId);
    const mask = await store.read(sim, sim.maskAssetId!);
    for (const key of STAGES) {
      const output = await store.read(sim, sim.stages[key].outputAssetId!);
      const result = await verifyExterior(working, mask, output);
      if (result.outsideChangedPixels !== 0) throw new Error('Píxeles externos alterados: ' + sim.id + ', etapa ' + key);
    }
    console.log(sim.id + ': original intacto; 3 etapas aceptadas; exterior exacto');
  }
  console.log('Verificación técnica completada para ' + sims.length + ' simulaciones. La revisión anatómica sigue siendo visual y humana.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló la evaluación visual.');
  process.exitCode = 1;
} finally { store.close(); }
