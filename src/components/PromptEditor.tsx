import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, Save } from 'lucide-react';
import type { PromptConfig, Simulation, StageKey } from '../../shared/domain';
import { STAGE_INFO, STAGES } from '../../shared/domain';
import { buildPrompt, DEFAULT_PROMPTS } from '../../shared/prompts';
import { Button, Notice } from './ui';

export function PromptEditor({ sim, saving, onDirtyChange, onSave, onCancel }: {
  sim: Simulation;
  saving: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (prompts: PromptConfig, revision: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [initial] = useState<PromptConfig>(() => structuredClone(sim.prompts));
  const [baseRevision] = useState(sim.revision);
  const [draft, setDraft] = useState<PromptConfig>(() => structuredClone(sim.prompts));
  const [previewStage, setPreviewStage] = useState<StageKey>('month_6');
  const firstField = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const stale = sim.revision !== baseRevision;
  const valid = draft.common.trim().length > 0 && draft.common.length <= 12_000 &&
    STAGES.every((key) => {
      const text = draft.stages[key];
      return typeof text === 'string' && text.trim().length > 0 && text.length <= 12_000;
    });
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => { firstField.current?.focus(); }, []);
  const setStage = (key: StageKey, value: string) =>
    setDraft((current) => ({ ...current, stages: { ...current.stages, [key]: value } }));
  return <section className="prompt-editor" aria-labelledby="prompt-editor-title">
    <div className="prompt-editor__head">
      <div><p className="eyebrow">Instrucciones de esta simulación</p><h2 id="prompt-editor-title">Editar prompts</h2>
        <p>La instrucción común se añade a cada etapa. Revisa abajo el texto completo del lote; las observaciones opcionales de una etapa se añaden al generarla por separado.</p></div>
      <Button icon={<ArrowLeft size={17} />} onClick={onCancel} disabled={saving}>Volver sin guardar</Button>
    </div>
    <Notice tone="info">Guardar prompts no modifica imágenes existentes. Se aplicarán al próximo intento de generación. Los intentos conservan una copia del texto enviado.</Notice>
    <Notice tone="info">El texto anterior de 18 meses y final habla de continuar la etapa previa. En el lote paralelo, esa frase describe la progresión visual; cada petición recibe el original.</Notice>
    {stale && <Notice tone="warning">Este estudio cambió en otra pestaña. Copia tus textos si quieres conservarlos, vuelve y abre de nuevo el editor antes de guardar.</Notice>}
    {sim.migratedFromLegacyTimeline && <Notice tone="warning">Este estudio usaba una secuencia anterior. Sus imágenes previas quedaron en el historial; genera la nueva secuencia para obtener 18 meses.</Notice>}
    <div className="prompt-editor__fields">
      <div className="prompt-editor__field">
        <label htmlFor="prompt-common">Instrucciones comunes</label>
        <p id="prompt-common-help">Identidad, dientes originales, encuadre y límites de la edición.</p>
        <textarea ref={firstField} id="prompt-common" className="resize-none" aria-describedby="prompt-common-help" value={draft.common}
          maxLength={12_000} onChange={(event) => setDraft((current) => ({ ...current, common: event.target.value }))} />
      </div>
      {STAGES.map((key) => <div className="prompt-editor__field" key={key}>
        <label htmlFor={'prompt-' + key}>{STAGE_INFO[key].label}</label>
        <p id={'prompt-' + key + '-help'}>Instrucciones específicas para esta fotografía independiente.</p>
        <textarea id={'prompt-' + key} className="resize-none" aria-describedby={'prompt-' + key + '-help'} value={draft.stages[key] ?? ''}
          maxLength={12_000} onChange={(event) => setStage(key, event.target.value)} />
      </div>)}
    </div>
    <div className="prompt-editor__preview">
      <h3>Vista previa del prompt completo</h3>
      <div className="prompt-editor__stages" aria-label="Elegir etapa para vista previa">
        {STAGES.map((key) => <button key={key} type="button" className={'prompt-editor__stage ' + (previewStage === key ? 'prompt-editor__stage--active' : '')}
          aria-pressed={previewStage === key} onClick={() => setPreviewStage(key)}>{STAGE_INFO[key].label}</button>)}
      </div>
      <pre>{buildPrompt(previewStage, '', draft)}</pre>
    </div>
    {!valid && <Notice tone="danger">Cada campo debe tener texto y no superar 12 000 caracteres.</Notice>}
    <div className="prompt-editor__actions">
      <Button icon={<RotateCcw size={17} />} onClick={() => setDraft(structuredClone(DEFAULT_PROMPTS))} disabled={saving}>Restaurar textos propuestos</Button>
      <Button tone="primary" shape="solid" icon={<Save size={17} />} onClick={() => { void onSave(draft, baseRevision); }} disabled={!dirty || !valid || saving || stale}>
        {saving ? 'Guardando…' : 'Guardar prompts'}
      </Button>
    </div>
  </section>;
}
