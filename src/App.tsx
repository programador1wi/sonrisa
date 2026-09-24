import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Eye, FileImage, ImagePlus, Pencil, RotateCcw, ShieldCheck, Sparkles, Trash2, Zap } from 'lucide-react';
import { api, ApiError } from './api';
import { UploadArea } from './components/UploadArea';
import { MaskEditor } from './components/MaskEditor';
import { PromptEditor } from './components/PromptEditor';
import { SplitComparisonViewer } from './components/SplitComparisonViewer';
import { Button, Dialog, ImagePanel, Notice } from './components/ui';
import { assetUrl, ATTEMPT_LABELS, busySimulation, firstIncomplete, STAGE_INFO, STAGES, STATUS_LABEL, TIMELINE } from '../shared/domain';
import type { Health, HistoryPage, PromptConfig, Simulation, StageKey } from '../shared/domain';

const date = (value: string) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const currentId = () => new URLSearchParams(location.search).get('sim') ?? undefined;

export default function App() {
  const [selectedId, setSelectedId] = useState<string | undefined>(currentId);
  const [sim, setSim] = useState<Simulation>();
  const [history, setHistory] = useState<HistoryPage>({ items: [], nextOffset: null });
  const [health, setHealth] = useState<Health>();
  const [notice, setNotice] = useState('');
  const [connectionNotice, setConnectionNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | undefined | null>(null);
  const refreshHistory = useCallback(async () => { setHistory(await api.history()); }, []);
  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    const load = async () => {
      try {
        const [nextHealth, nextHistory] = await Promise.all([api.health(), api.history()]);
        if (!active) return;
        setHealth(nextHealth);
        setHistory(nextHistory);
        setConnectionNotice('');
      } catch {
        if (!active) return;
        setConnectionNotice('La API local está iniciando o reiniciando. Reconectando automáticamente…');
        retry = window.setTimeout(() => { void load(); }, 1_000);
      }
    };
    void load();
    return () => { active = false; if (retry !== undefined) window.clearTimeout(retry); };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const load = async () => {
      try {
        const next = await api.get(selectedId);
        if (active) {
          setSim((old) => old?.id === next.id && old.revision > next.revision ? old : next);
          setConnectionNotice('');
        }
      } catch (reason) {
        if (active) {
          if (!(reason instanceof ApiError) || reason.status >= 500)
            setConnectionNotice('La API local está iniciando o reiniciando. Reconectando automáticamente…');
          else setNotice(reason.message);
        }
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 1500);
    return () => { active = false; window.clearInterval(interval); };
  }, [selectedId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const restore = () => {
      const target = currentId();
      if (dirty && target !== selectedId) {
        historyReplace(selectedId);
        setPendingNav(target ?? '');
      } else {
        setSelectedId(target); setSim(undefined); setNotice('');
      }
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [dirty, selectedId]);
  const navigate = (id?: string) => {
    if (id === selectedId) return;
    if (dirty) { setPendingNav(id ?? ''); return; }
    historyPush(id); setSelectedId(id); setSim(undefined); setNotice(''); setDirty(false);
  };
  const continueNavigation = () => {
    const id = pendingNav || undefined;
    setPendingNav(null); setDirty(false);
    historyPush(id); setSelectedId(id); setSim(undefined); setNotice('');
  };
  const uploaded = (created: Simulation) => {
    setSim(created); setDirty(false); setNotice('');
    historyPush(created.id); setSelectedId(created.id);
    void refreshHistory();
  };
  const more = async () => {
    if (history.nextOffset === null) return;
    try {
      const next = await api.history(history.nextOffset);
      setHistory((old) => ({ items: [...old.items, ...next.items], nextOffset: next.nextOffset }));
    } catch { setNotice('No se pudo cargar más historial. Intenta de nuevo.'); }
  };
  const changeProvider = async (mode: 'gemini' | 'openai') => {
    try {
      await api.switchProvider(mode);
      const nextHealth = await api.health();
      setHealth(nextHealth);
      if (selectedId) {
        setSim(await api.get(selectedId));
      }
      setNotice('');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'No se pudo cambiar de proveedor.');
    }
  };
  return <div className="app">
    <header className="site-header">
      <div className="brand"><span className="brand__mark" aria-hidden="true">S</span><span><strong>Sonrisa</strong><small>Estudio de evolución</small></span></div>
      <div className="site-header__controls">
        {health?.mode !== 'test' && (
          <div className="provider-selector" role="radiogroup" aria-label="Motor de Inteligencia Artificial">
            <button
              type="button"
              role="radio"
              aria-checked={health?.mode === 'gemini'}
              className={'provider-pill ' + (health?.mode === 'gemini' ? 'provider-pill--active' : '')}
              onClick={() => { void changeProvider('gemini'); }}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>Gemini</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={health?.mode === 'openai'}
              className={'provider-pill ' + (health?.mode === 'openai' ? 'provider-pill--active' : '')}
              onClick={() => { void changeProvider('openai'); }}
            >
              <Zap size={14} aria-hidden="true" />
              <span>OpenAI</span>
            </button>
          </div>
        )}
        <span className="site-header__meta"><span className={'status-dot ' + (health?.ready ? 'status-dot--ready' : '')} />{health?.mode === 'test' ? 'Proveedor de prueba' : health?.ready ? `${health?.mode === 'openai' ? 'OpenAI' : 'Gemini'} listo` : 'Preparación local'}</span>
      </div>
    </header>
    <div className="app-shell">
      <aside className="sidebar" aria-label="Simulaciones">
        <div className="sidebar__head"><p className="eyebrow">Espacio local</p><h2>Mis estudios</h2>
          <Button tone="primary" shape="solid" icon={<ImagePlus size={18} />} onClick={() => navigate(undefined)}>Nueva simulación</Button>
        </div>
        <div className="sidebar__list">
          {history.items.length === 0 && <p className="muted sidebar__empty">Todavía no hay simulaciones. Carga una fotografía para empezar.</p>}
          {history.items.map((item) => <button key={item.id} type="button" className={'history-item ' + (selectedId === item.id ? 'history-item--active' : '')} onClick={() => navigate(item.id)}>
            <img src={assetUrl(item.id, item.originalAssetId)} alt="" loading="lazy" />
            <span className="history-item__text"><strong title={item.name}>{item.name}</strong><small>{date(item.updatedAt)}</small><small>{item.busy ? 'Generando' : item.accepted + ' de 3 etapas aceptadas'}</small></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
          {history.nextOffset !== null && <Button shape="ghost" onClick={() => { void more(); }}>Cargar más</Button>}
        </div>
        <div className="sidebar__foot"><ShieldCheck size={18} /><span>Fotografías guardadas en este equipo</span></div>
      </aside>
      <main className="main">
        {connectionNotice && <Notice tone="warning">{connectionNotice}</Notice>}
        {notice && <Notice tone="danger">{notice}</Notice>}
        {selectedId && !sim && <div className="loading-panel" role="status">Cargando simulación…</div>}
        {sim && selectedId === sim.id ? <Workspace key={sim.id} sim={sim} setSim={setSim} health={health}
          onDirtyChange={setDirty} onError={setNotice} onDeleted={() => { setDirty(false); setSim(undefined); historyPush(undefined); setSelectedId(undefined); void refreshHistory(); }}
          refreshHistory={refreshHistory} /> : !selectedId && <div className="landing">
            <div className="landing__intro"><p className="eyebrow">Una misma sonrisa. Cuatro momentos.</p>
              <h1>Visualiza una evolución <em>sin perder a la persona.</em></h1>
              <p>Delimita los dientes, ajusta los prompts y revisa cada resultado conservando el rostro original.</p>
              <div className="landing__sequence" aria-label="Secuencia prevista"><span>AHORA</span><ArrowRight size={16} /><span>6 MESES</span><ArrowRight size={16} /><span>18 MESES</span><ArrowRight size={16} /><span>FINAL</span></div>
            </div>
            <UploadArea onUploaded={uploaded} />
            <Notice tone="info"><CircleHelp size={18} aria-hidden="true" />La secuencia es una simulación visual estética. No predice movimientos ni duración clínica.</Notice>
          </div>}
      </main>
    </div>
    <Dialog open={pendingNav !== null} title="Tienes una selección sin guardar" initialCancel
      onClose={() => setPendingNav(null)}
      actions={<><Button data-cancel onClick={() => setPendingNav(null)}>Seguir editando</Button><Button tone="danger" shape="solid" onClick={continueNavigation}>Descartar selección</Button></>}>
      <p>Si cambias de simulación ahora, perderás los trazos sin guardar de la máscara dental.</p>
    </Dialog>
  </div>;
}
function historyPush(id?: string) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('sim', id); else url.searchParams.delete('sim');
  window.history.pushState({}, '', url);
}
function historyReplace(id?: string) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('sim', id); else url.searchParams.delete('sim');
  window.history.replaceState({}, '', url);
}

type Confirm = { title: string; body: string; action: string; tone: 'primary' | 'danger'; run: () => Promise<void>; cancel?: () => void };
function Workspace({ sim, setSim, health, onDirtyChange, onError, onDeleted, refreshHistory }: {
  sim: Simulation; setSim: (value: Simulation | undefined) => void; health?: Health; onDirtyChange: (value: boolean) => void;
  onError: (value: string) => void; onDeleted: () => void; refreshHistory: () => Promise<void>;
}) {
  const [editingMask, setEditingMask] = useState(!sim.maskAssetId);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const promptReturnFocus = useRef(false);
  const [focus, setFocus] = useState<StageKey | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [compare, setCompare] = useState<StageKey | null>(null);
  useEffect(() => {
    if (!editingPrompts && promptReturnFocus.current) {
      promptReturnFocus.current = false;
      document.getElementById('edit-prompts-trigger')?.focus();
    }
  }, [editingPrompts]);
  const stageKey = focus ?? firstIncomplete(sim) ?? 'final';
  const stage = sim.stages[stageKey];
  const busyJob = busySimulation(sim);
  const allAccepted = STAGES.every((key) => sim.stages[key].status === 'accepted');
  const acceptedCount = STAGES.filter((key) => sim.stages[key].status === 'accepted').length;
  const providerMismatch = Boolean(health && (sim.provider ?? 'gemini') !== health.mode);
  const providerName = health?.mode === 'openai' ? 'OpenAI' : 'Gemini';
  const providerCanChange = providerMismatch && Boolean(health?.ready) && sim.attempts.length === 0 &&
    STAGES.every((key) => sim.stages[key].status === 'pending' && !sim.stages[key].outputAssetId);
  const month6Attempt = sim.attempts.find((attempt) => attempt.id === sim.stages.month_6.attemptId);
  const month6Outdated = Boolean(month6Attempt && health?.promptVersion &&
    (month6Attempt.promptVersion !== health.promptVersion || month6Attempt.promptRevision !== sim.promptRevision));
  const batchLabel = 'Generar las 3 imágenes';
  const act = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); onError('');
    try { return await fn(); }
    catch (reason) {
      onError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
      if (reason instanceof ApiError && reason.code === 'STALE_REVISION') {
        try { setSim(await api.get(sim.id)); } catch { /* Show original error. */ }
      }
      return undefined;
    } finally { setBusy(false); }
  };
  const saveMask = async (png: string): Promise<boolean> => {
    const save = async () => {
      const next = await act(() => api.mask(sim, png));
        if (next) { onDirtyChange(false); setSim(next); setEditingMask(false); setFocus(null); void refreshHistory(); }
      return Boolean(next);
    };
    if (sim.maskAssetId && (sim.attempts.length > 0 || Object.values(sim.stages).some((item) => item.status !== 'pending'))) {
      return new Promise<boolean>((resolve) => setConfirm({
        title: 'Cambiar región dental', body: 'Se invalidarán los resultados vigentes. Los intentos anteriores permanecerán en el historial local.',
        action: 'Guardar e invalidar etapas', tone: 'danger',
        run: async () => { resolve(await save()); }, cancel: () => resolve(false),
      }));
    }
    return save();
  };
  const savePrompts = async (prompts: PromptConfig, revision: number) => {
    const next = await act(() => api.prompts({ ...sim, revision }, prompts));
    if (next) { setSim(next); onDirtyChange(false); setEditingPrompts(false); void refreshHistory(); }
  };
  const generate = async (key: StageKey) => {
    const result = await act(() => api.generate(sim, key, notes, crypto.randomUUID()));
    if (result) { setSim(result.simulation); setFocus(key); setNotes(''); void refreshHistory(); }
  };
  const selectProvider = async () => {
    const next = await act(() => api.selectProvider(sim));
    if (next) { setSim(next); void refreshHistory(); }
  };
  const generateBatch = async () => {
    const result = await act(() => api.generateBatch(sim, crypto.randomUUID()));
    if (result) { setSim(result.simulation); setFocus('month_6'); void refreshHistory(); }
  };
  const requestBatch = () => {
    const replaces = STAGES.some((key) => sim.stages[key].status !== 'pending');
    if (replaces) setConfirm({
      title: 'Generar secuencia completa',
      body: `Se solicitarán 3 imágenes en paralelo a ${providerName}: 6 meses, 18 meses y resultado final. Cada llamada puede tener costo, incluso si otra falla. Los resultados vigentes se reemplazarán y los intentos anteriores quedarán en el historial.`,
      action: batchLabel, tone: 'primary', run: generateBatch,
    });
    else void generateBatch();
  };
  const requestGeneration = () => {
    if (stage.status !== 'pending' || STAGES.some((key) => sim.stages[key].status !== 'pending' && key !== stageKey)) {
      setConfirm({
        title: 'Generar nueva versión', body: `Se enviará una nueva petición a ${providerName} para esta etapa. Las imágenes generadas en paralelo se conservan. Si una imagen antigua usó esta etapa como referencia, dejará de estar vigente. Los intentos anteriores quedarán en el historial.`,
        action: 'Generar nueva versión', tone: 'primary', run: async () => { await generate(stageKey); },
      });
    } else void generate(stageKey);
  };
  const review = async (decision: 'accept' | 'reject') => {
    const reviewed = await act(() => api.review(sim, stageKey, decision));
    if (!reviewed) return;
    setSim(reviewed); void refreshHistory();
    if (decision === 'accept') {
      const next = STAGES.slice(STAGES.indexOf(stageKey) + 1).find((key) => reviewed.stages[key].status === 'needs_review');
      if (next) setFocus(next);
    }
  };
  const deleteSim = () => setConfirm({
    title: 'Eliminar simulación', body: 'Se eliminarán la fotografía original, la máscara, los intentos y los resultados guardados en este equipo.',
    action: 'Eliminar simulación', tone: 'danger',
    run: async () => { const result = await act(async () => { await api.remove(sim); return true; }); if (result) onDeleted(); },
  });
  const closeConfirm = () => { confirm?.cancel?.(); setConfirm(null); };
  return <div className="workspace">
    <div className="workspace__top"><div><p className="eyebrow">Estudio local · {date(sim.createdAt)}</p>
        <h1>{sim.name}</h1><p className="muted">{sim.width} × {sim.height} píxeles · {acceptedCount} de 3 etapas aceptadas · {sim.provider === 'openai' ? 'OpenAI' : sim.provider === 'test' ? 'Prueba' : 'Gemini'}</p></div>
      <div className="workspace__top-actions">{!editingPrompts && <Button shape="outline" icon={<ArrowLeft size={16} />} onClick={() => setEditingMask(true)} disabled={busyJob}>Ajustar región</Button>}
        {!editingMask && !editingPrompts && <Button id="edit-prompts-trigger" shape="outline" icon={<Pencil size={16} />}
          onClick={() => { promptReturnFocus.current = true; setEditingPrompts(true); }} disabled={busyJob}>Editar prompts</Button>}
        <Button shape="ghost" tone="danger" icon={<Trash2 size={16} />} onClick={deleteSim} disabled={busyJob || busy || editingPrompts}>Eliminar</Button></div>
    </div>
    <div className="workflow-meter" role="progressbar" aria-label="Avance de etapas" aria-valuemin={0} aria-valuemax={3} aria-valuenow={acceptedCount}><span style={{ width: acceptedCount / 3 * 100 + '%' }} /></div>
    {health?.mode === 'test' && <Notice tone="warning">Modo de prueba: las imágenes generadas son sintéticas y no evalúan el resultado dental.</Notice>}
    {health && !health.ready && <Notice tone="warning">{health.warning ?? 'El proveedor no está configurado.'} Puedes delimitar la región dental mientras tanto.</Notice>}
    {providerMismatch && <Notice tone="warning">Este estudio se creó con {sim.provider === 'openai' ? 'OpenAI' : 'Gemini'}. {providerCanChange ? <>Puedes conservar la foto y la máscara al asignarlo a {providerName}. <Button onClick={() => { void selectProvider(); }} disabled={busy}>Usar {providerName} en este estudio</Button></> : `Para usar ${providerName}, crea un estudio nuevo o vuelve a seleccionar su proveedor original en .env.local o .env y reinicia.`}</Notice>}
    {month6Outdated && !busyJob && <Notice tone="warning">Los prompts cambiaron desde la imagen vigente de 6 meses. Genera una nueva secuencia para aplicar los textos actuales.</Notice>}
    {sim.migratedFromLegacyTimeline && STAGES.every((key) => sim.stages[key].status === 'pending') &&
      <Notice tone="info">La secuencia anterior quedó en el historial. Genera 6 meses, 18 meses y final con la nueva estructura.</Notice>}
    {editingMask ? <MaskEditor key={sim.id + '-' + sim.maskVersion} sim={sim} onSave={saveMask} onDirtyChange={onDirtyChange} /> :
      editingPrompts ? <PromptEditor sim={sim} saving={busy} onDirtyChange={onDirtyChange} onSave={savePrompts}
        onCancel={() => { onDirtyChange(false); setEditingPrompts(false); }} /> : <>
      <div className="section-heading"><div><p className="eyebrow">Paso 02 · generar y revisar</p><h2>Una evolución, tres fotografías</h2>
        <p>Genera 6 meses, 18 meses y resultado final en paralelo desde el mismo original. Cada fotografía aparece en cuanto está lista.</p></div>
        <Button tone="primary" shape="solid" icon={<ImagePlus size={18} />} onClick={requestBatch}
          disabled={busy || busyJob || !health?.ready || providerMismatch}>{batchLabel}</Button></div>
      {busyJob && <Notice tone="info">Hasta tres imágenes se procesan a la vez. Puedes revisar las que estén listas o recargar la página. Si una falla, las demás continúan; no habrá reintentos automáticos.</Notice>}
      <div className="timeline" aria-label="Línea de tiempo visual">
        <button type="button" className="timeline-card timeline-card--original" onClick={() => setCompare(stage.outputAssetId ? stageKey : 'month_6')}>
          <img src={assetUrl(sim.id, sim.originalAssetId)} alt="Fotografía original sin cambios" />
          <span className="timeline-card__text"><strong>AHORA</strong><small>Original intacto</small></span>
        </button>
        {TIMELINE.map((key) => {
          const item = sim.stages[key];
          return <button key={key} type="button" className={'timeline-card ' + (stageKey === key ? 'timeline-card--active' : '')} aria-pressed={stageKey === key} onClick={() => { setFocus(key); setNotes(''); }}>
            {item.outputAssetId ? <img src={assetUrl(sim.id, item.outputAssetId)} alt={'Resultado de ' + STAGE_INFO[key].label} /> : <span className="timeline-card__placeholder"><FileImage size={22} /></span>}
            <span className="timeline-card__text"><strong>{STAGE_INFO[key].label}</strong><small>{item.status === 'failed' && sim.attempts.some((attempt) =>
              attempt.id === item.attemptId && attempt.errorCode?.startsWith('VISUAL_')) ? 'Apartado por control visual' : STATUS_LABEL[item.status]}</small></span>
          </button>;
        })}
      </div>
      <div className="review-layout">
        <div className="review-layout__images">
          <ImagePanel id={sim.id} assetId={sim.originalAssetId} label="AHORA · fotografía original" />
          {stage.outputAssetId ? <ImagePanel id={sim.id} assetId={stage.outputAssetId}
            label={STAGE_INFO[stageKey].label + ' · ' + STATUS_LABEL[stage.status]}
            download={stage.status === 'accepted' ? STAGE_INFO[stageKey].filename : undefined} /> :
            <div className="image-panel image-panel--empty"><div className="image-panel__frame"><FileImage size={32} /><span>La imagen aparecerá aquí al terminar la generación.</span></div><div className="image-panel__caption">{STAGE_INFO[stageKey].label}</div></div>}
        </div>
        <aside className="review-panel" aria-labelledby="stage-title"><p className="eyebrow">Etapa seleccionada</p>
          <h2 id="stage-title">{STAGE_INFO[stageKey].label}</h2>
          <p className="review-panel__progress">{STAGE_INFO[stageKey].progress}</p>
          {stageKey === 'final' && <p>Alineación natural desde los dientes originales, sin brackets. Compara también su coherencia con las otras etapas.</p>}
          {stageKey !== 'final' && <p>Brackets metálicos pequeños y coherentes. Revisa que cada diente conserve su forma y color.</p>}
          {stage.quality && <div className="quality"><ShieldCheck size={18} /><span>Exterior verificado: {stage.quality.outsideChangedPixels} píxeles cambiados fuera de la máscara.</span></div>}
          {stage.error && <Notice tone={stage.status === 'interrupted' ? 'warning' : 'danger'}>{stage.error}</Notice>}
          {busyJob && ['queued', 'generating'].includes(stage.status) && <div className="working-state" role="status"><span className="working-state__spinner" /><strong>{stage.status === 'queued' ? 'En espera de generación…' : `${providerName} está generando esta etapa…`}</strong><p>La página puede recargarse; este intento permanecerá registrado.</p></div>}
          {!busyJob && stage.status !== 'needs_review' && <div className="review-panel__form">
            <label htmlFor="revision-notes">Observaciones para la siguiente generación <span>(opcional)</span></label>
            <textarea id="revision-notes" className="resize-none" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. conservar la pequeña irregularidad del incisivo derecho" />
            <Button tone="primary" shape="solid" icon={stage.status === 'pending' ? <ArrowRight size={18} /> : <RotateCcw size={18} />}
              disabled={busy || !health?.ready || providerMismatch} onClick={requestGeneration}>{stage.version ? 'Regenerar esta etapa' : 'Generar esta etapa'}</Button>
          </div>}
          {stage.status === 'needs_review' && <div className="review-panel__review">
            <Notice tone="info">Revisa dientes, labios, brackets y progresión. La validación técnica solo garantiza el exterior de la máscara.</Notice>
            <Button tone="neutral" shape="outline" icon={<Eye size={17} />} onClick={() => setCompare(stageKey)}>Comparar en grande</Button>
            <Button tone="danger" shape="outline" disabled={busy} onClick={() => { void review('reject'); }}>Rechazar candidato</Button>
            <Button tone="primary" shape="solid" icon={<Check size={18} />} disabled={busy} onClick={() => { void review('accept'); }}>
              {stageKey === 'final' ? 'Aceptar etapa' : 'Aceptar y revisar siguiente'}
            </Button>
          </div>}
          {stage.status === 'accepted' && <Notice tone="success">Etapa aceptada. Puedes revisar o descargar su fotografía independiente.</Notice>}
          {stage.outputAssetId && <Button tone="neutral" shape="outline" icon={<Eye size={17} />} onClick={() => setCompare(stageKey)}>Abrir comparación</Button>}
        </aside>
      </div>
      {allAccepted && <section className="completion" role="status"><Check size={22} /><div><h2>Las tres etapas están listas</h2><p>Descarga cada fotografía desde su etapa. AHORA sigue siendo el archivo original.</p></div></section>}
      {sim.attempts.length > 0 && <details className="attempt-history"><summary>Historial de intentos · {sim.attempts.length}</summary>
        <ul>{[...sim.attempts].reverse().map((attempt) => <li key={attempt.id}>
          <strong>{ATTEMPT_LABELS[attempt.stage]}</strong><span>{date(attempt.createdAt)}</span><span>{attempt.status === 'failed' && attempt.errorCode?.startsWith('VISUAL_') ? 'Apartado por control visual' : STATUS_LABEL[attempt.status]}</span>
          {attempt.error && <small>{attempt.error}</small>}
          {attempt.usage && <small>Consumo informado: {JSON.stringify(attempt.usage)}</small>}
          {attempt.providerDurationMs !== undefined && <small>Tiempo del proveedor: {(attempt.providerDurationMs / 1000).toFixed(1)} s</small>}
          {attempt.outputAssetId && <a className="text-link" href={assetUrl(sim.id, attempt.outputAssetId)} target="_blank" rel="noopener noreferrer">Ver imagen del intento</a>}
          {attempt.errorCode?.startsWith('VISUAL_') && attempt.candidateAssetId &&
            <a className="text-link" href={assetUrl(sim.id, attempt.candidateAssetId)} target="_blank" rel="noopener noreferrer">Ver recorte apartado</a>}
          {attempt.promptText && <details className="attempt-history__prompt"><summary>Ver prompt enviado</summary><pre>{attempt.promptText}</pre></details>}
        </li>)}</ul>
      </details>}
      <p className="workspace__disclaimer"><CircleHelp size={16} /> Simulación visual estética. No constituye diagnóstico ni predicción de movimientos, duración o resultado clínico.</p>
    </>}
    <Dialog open={Boolean(confirm)} title={confirm?.title ?? ''} initialCancel onClose={closeConfirm}
      actions={<><Button data-cancel onClick={closeConfirm}>Cancelar</Button><Button tone={confirm?.tone} shape="solid" disabled={busy}
        onClick={() => { const action = confirm?.run; setConfirm(null); if (action) void action(); }}>{confirm?.action}</Button></>}>
      <p>{confirm?.body}</p>
    </Dialog>
    <Dialog open={Boolean(compare)} title={compare ? 'Comparar · ' + STAGE_INFO[compare].label : 'Comparar'} wide onClose={() => setCompare(null)}>
      {compare && sim.stages[compare].outputAssetId ? (
        <SplitComparisonViewer
          originalUrl={assetUrl(sim.id, sim.originalAssetId)}
          candidateUrl={assetUrl(sim.id, sim.stages[compare].outputAssetId!)}
          labelOriginal="AHORA · Fotografía original"
          labelCandidate={STAGE_INFO[compare].label + ' · ' + STATUS_LABEL[sim.stages[compare].status]}
          downloadCandidate={sim.stages[compare].status === 'accepted' ? STAGE_INFO[compare].filename : undefined}
        />
      ) : (
        compare && <ImagePanel id={sim.id} assetId={sim.originalAssetId} label="AHORA · original" />
      )}
    </Dialog>
  </div>;
}
