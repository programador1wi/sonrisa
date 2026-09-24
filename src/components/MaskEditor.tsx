import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Brush, Eraser, Hand, RotateCcw, Save, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { assetUrl, type Simulation } from '../../shared/domain';
import { Button, Notice } from './ui';

type Tool = 'brush' | 'erase' | 'pan';

export function MaskEditor({ sim, onSave, onDirtyChange }: {
  sim: Simulation; onSave: (base64: string) => Promise<boolean>; onDirtyChange: (dirty: boolean) => void;
}) {
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<string[]>([]);
  const panOrigin = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [tool, setTool] = useState<Tool>('brush');
  const [overlayOpacity, setOverlayOpacity] = useState(48);
  const [size, setSize] = useState(() => Math.max(1, Math.min(12, Math.round(sim.width * .008))));
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(Math.min(900, 560 * sim.width / sim.height));
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rect, setRect] = useState({ x: 0, y: 0, width: Math.max(1, Math.round(sim.width * .2)), height: Math.max(1, Math.round(sim.height * .1)) });

  const paintOverlay = useCallback(() => {
    const source = maskRef.current, canvas = overlayRef.current;
    if (!source || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, sim.width, sim.height);
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgba(18, 123, 113, ${overlayOpacity / 100})`;
    ctx.fillRect(0, 0, sim.width, sim.height);
    ctx.globalCompositeOperation = 'source-over';
  }, [sim.width, sim.height, overlayOpacity]);

  useEffect(() => {
    if (ready) paintOverlay();
  }, [overlayOpacity, ready, paintOverlay]);

  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement('canvas');
    canvas.width = sim.width; canvas.height = sim.height;
    maskRef.current = canvas;
    const overlay = overlayRef.current;
    if (overlay) { overlay.width = sim.width; overlay.height = sim.height; }
    const load = async () => {
      if (sim.maskAssetId) {
        const image = new Image();
        image.src = assetUrl(sim.id, sim.maskAssetId);
        await image.decode();
        if (cancelled) return;
        const temp = document.createElement('canvas');
        temp.width = sim.width; temp.height = sim.height;
        const ctx = temp.getContext('2d', { willReadFrequently: true });
        const target = canvas.getContext('2d');
        if (!ctx || !target) throw new Error('No se pudo iniciar el editor de máscara.');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, sim.width, sim.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const selected = (pixels.data[i] ?? 0) >= 128 && (pixels.data[i + 3] ?? 0) > 0;
          pixels.data[i] = 255; pixels.data[i + 1] = 255; pixels.data[i + 2] = 255;
          pixels.data[i + 3] = selected ? 255 : 0;
        }
        target.putImageData(pixels, 0, 0);
      }
      if (!cancelled) { paintOverlay(); setReady(true); setDirty(false); undoStack.current = []; setUndoCount(0); }
    };
    void load().catch(() => { if (!cancelled) setError('No se pudo abrir la máscara guardada. Recarga la página.'); });
    return () => { cancelled = true; maskRef.current = null; };
  }, [sim.id, sim.width, sim.height, sim.maskAssetId, paintOverlay]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setFit(Math.min(900, 560 * sim.width / sim.height, Math.max(1, container.clientWidth - 24))));
    observer.observe(container);
    return () => observer.disconnect();
  }, [sim.width, sim.height]);

  const saveUndo = () => {
    const canvas = maskRef.current;
    if (!canvas) return;
    undoStack.current.push(canvas.toDataURL('image/png'));
    if (undoStack.current.length > 8) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  };

  const coords = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = overlayRef.current!, box = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(sim.width - 1, (event.clientX - box.left) * sim.width / box.width)),
      y: Math.max(0, Math.min(sim.height - 1, (event.clientY - box.top) * sim.height / box.height)),
    };
  };

  const draw = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = maskRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    paintOverlay(); setDirty(true);
  };

  const undo = async () => {
    const previous = undoStack.current.pop();
    if (!previous || !maskRef.current) return;
    setUndoCount(undoStack.current.length);
    const image = new Image(); image.src = previous; await image.decode();
    const ctx = maskRef.current.getContext('2d');
    ctx?.clearRect(0, 0, sim.width, sim.height);
    ctx?.drawImage(image, 0, 0);
    paintOverlay(); setDirty(true);
  };

  const clearSelection = () => {
    const canvas = maskRef.current;
    if (!canvas) return;
    saveUndo();
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, sim.width, sim.height);
    paintOverlay();
    setDirty(true);
    setError('');
  };

  const addRectangle = () => {
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > sim.width || y + height > sim.height) {
      setError('El rectángulo debe quedar dentro de la fotografía y medir al menos un píxel.'); return;
    }
    const ctx = maskRef.current?.getContext('2d');
    if (!ctx) return;
    saveUndo();
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, width, height);
    ctx.globalCompositeOperation = 'source-over';
    paintOverlay(); setDirty(true); setError('');
  };

  const save = async () => {
    if (!maskRef.current || !dirty) return;
    setSaving(true); setError('');
    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = sim.width; exportCanvas.height = sim.height;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo exportar la selección.');
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, sim.width, sim.height);
      ctx.drawImage(maskRef.current, 0, 0);
      const encoded = exportCanvas.toDataURL('image/png').split(',')[1];
      if (!encoded) throw new Error('No se pudo exportar la selección.');
      if (await onSave(encoded)) { setDirty(false); undoStack.current = []; setUndoCount(0); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la región dental.'); }
    finally { setSaving(false); }
  };

  const updateRect = (field: keyof typeof rect, value: string) => setRect((current) => ({ ...current, [field]: Number(value) }));

  // Pointer event handlers for drawing or panning
  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'pan') {
      panOrigin.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: containerRef.current?.scrollLeft ?? 0,
        scrollTop: containerRef.current?.scrollTop ?? 0,
      };
      return;
    }

    saveUndo();
    dragging.current = true;
    last.current = coords(event);
    draw(last.current, last.current);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan') {
      if (!panOrigin.current || !containerRef.current) return;
      const dx = event.clientX - panOrigin.current.x;
      const dy = event.clientY - panOrigin.current.y;
      containerRef.current.scrollLeft = panOrigin.current.scrollLeft - dx;
      containerRef.current.scrollTop = panOrigin.current.scrollTop - dy;
      return;
    }

    const point = coords(event);
    setCursor(point);
    if (!dragging.current || !last.current) return;
    draw(last.current, point);
    last.current = point;
  };

  const handlePointerUp = () => {
    dragging.current = false;
    last.current = null;
    panOrigin.current = null;
  };

  return (
    <section className="mask-editor" aria-labelledby="mask-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Paso 01 · delimitar</p>
          <h2 id="mask-title">Marca solo la zona dental</h2>
          <p>Incluye pequeños espacios donde los dientes pueden alinearse. Protege labios, piel y encías.</p>
        </div>
      </div>
      <div className="mask-editor__toolbar" role="toolbar" aria-label="Herramientas de máscara">
        <Button
          shape={tool === 'brush' ? 'solid' : 'outline'}
          tone={tool === 'brush' ? 'primary' : 'neutral'}
          icon={<Brush size={16} />}
          aria-pressed={tool === 'brush'}
          onClick={() => setTool('brush')}
        >
          Marcar
        </Button>
        <Button
          shape={tool === 'erase' ? 'solid' : 'outline'}
          tone={tool === 'erase' ? 'primary' : 'neutral'}
          icon={<Eraser size={16} />}
          aria-pressed={tool === 'erase'}
          onClick={() => setTool('erase')}
        >
          Borrar
        </Button>
        <Button
          shape={tool === 'pan' ? 'solid' : 'outline'}
          tone={tool === 'pan' ? 'primary' : 'neutral'}
          icon={<Hand size={16} />}
          aria-pressed={tool === 'pan'}
          onClick={() => setTool('pan')}
        >
          Mover
        </Button>
        <label className="range-control">
          Tamaño del pincel
          <input
            type="range"
            min="1"
            max="100"
            value={size}
            aria-label="Tamaño del pincel"
            onChange={(event) => setSize(Number(event.target.value))}
          />
          <span>{size} px</span>
        </label>
        <label className="range-control">
          Opacidad
          <input
            type="range"
            min="15"
            max="85"
            value={overlayOpacity}
            aria-label="Opacidad de la máscara verde"
            onChange={(event) => setOverlayOpacity(Number(event.target.value))}
          />
          <span>{overlayOpacity} %</span>
        </label>
        <Button icon={<RotateCcw size={16} />} onClick={() => { void undo(); }} disabled={!undoCount}>
          Deshacer
        </Button>
        <Button icon={<Trash2 size={16} />} onClick={clearSelection} disabled={!dirty && !sim.maskAssetId} aria-label="Limpiar selección completa">
          Limpiar
        </Button>
        <div className="toolbar-spacer" />
        <Button icon={<ZoomOut size={16} />} aria-label="Alejar imagen" onClick={() => setZoom((value) => Math.max(1, value - .25))} disabled={zoom <= 1}>
          Alejar
        </Button>
        <span className="zoom-label" aria-label="Zoom respecto al encuadre inicial">{Math.round(zoom * 100)} %</span>
        <Button icon={<ZoomIn size={16} />} aria-label="Acercar imagen" onClick={() => setZoom((value) => Math.min(8, value + .5))} disabled={zoom >= 8}>
          Acercar
        </Button>
      </div>
      <div className="mask-editor__viewport" ref={containerRef}>
        <div className="mask-editor__stage" style={{ width: fit * zoom, height: fit * zoom * sim.height / sim.width }}>
          <img src={assetUrl(sim.id, sim.workingAssetId)} alt="Fotografía original para delimitar los dientes" draggable={false} />
          <canvas
            ref={overlayRef}
            className={'mask-editor__canvas ' + (tool === 'pan' ? 'mask-editor__canvas--pan' : '')}
            aria-label="Dibuja sobre la región dental; alternativa numérica debajo"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => { setCursor(null); if (tool === 'pan') panOrigin.current = null; }}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {cursor && tool !== 'pan' && (
            <span
              className="mask-editor__brush-preview"
              aria-hidden="true"
              style={{
                left: cursor.x / sim.width * 100 + '%',
                top: cursor.y / sim.height * 100 + '%',
                width: size / sim.width * fit * zoom,
                height: size / sim.width * fit * zoom,
              }}
            />
          )}
        </div>
      </div>
      <p className="muted">Amplía la boca antes de marcar. El círculo muestra el diámetro del pincel; la herramienta Mover te permite desplazarte con zoom alto.</p>
      <details className="rectangle-entry">
        <summary>Alternativa sin arrastrar: marcar por coordenadas</summary>
        <div className="rectangle-entry__grid">
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <label key={field}>
              {field === 'x' ? 'Posición X' : field === 'y' ? 'Posición Y' : field === 'width' ? 'Ancho' : 'Alto'}
              <input
                type="number"
                min={field === 'width' || field === 'height' ? 1 : 0}
                max={field === 'x' || field === 'width' ? sim.width : sim.height}
                value={rect[field]}
                onChange={(event) => updateRect(field, event.target.value)}
              />
            </label>
          ))}
          <Button onClick={addRectangle}>{tool === 'erase' ? 'Borrar rectángulo' : 'Marcar rectángulo'}</Button>
        </div>
        <p>Coordenadas sobre la copia de trabajo: {sim.width} × {sim.height} píxeles.</p>
      </details>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="mask-editor__footer">
        <p className="muted">{dirty ? 'Selección sin guardar' : sim.maskAssetId ? 'Selección guardada' : 'Dibuja para continuar'}</p>
        <Button
          tone="primary"
          shape="solid"
          icon={<Save size={18} />}
          disabled={!dirty || saving || !ready}
          onClick={() => { void save(); }}
        >
          {saving ? 'Guardando…' : 'Confirmar región dental'}
        </Button>
      </div>
    </section>
  );
}
