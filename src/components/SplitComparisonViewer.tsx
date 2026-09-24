import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Columns2, Eye, EyeOff, Layers, SlidersHorizontal } from 'lucide-react';
import { Button } from './ui';

export type ComparisonMode = 'slider' | 'fade' | 'side-by-side';

interface SplitComparisonViewerProps {
  originalUrl: string;
  candidateUrl: string;
  labelOriginal: string;
  labelCandidate: string;
  downloadCandidate?: string;
  initialMode?: ComparisonMode;
}

export function SplitComparisonViewer({
  originalUrl,
  candidateUrl,
  labelOriginal,
  labelCandidate,
  downloadCandidate,
  initialMode = 'slider',
}: SplitComparisonViewerProps) {
  const [mode, setMode] = useState<ComparisonMode>(initialMode);
  const [position, setPosition] = useState(50); // percentage 0 - 100
  const [fadeOpacity, setFadeOpacity] = useState(50); // percentage 0 - 100
  const [blinking, setBlinking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(Math.round(percentage * 10) / 10);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'slider') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    updatePosition(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    updatePosition(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      dragging.current = false;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* Ignore pointer release errors */
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'slider') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPosition((prev) => Math.max(0, prev - 5));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPosition((prev) => Math.min(100, prev + 5));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPosition(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPosition(100);
    }
  };

  // Blink toggle timer
  useEffect(() => {
    if (!blinking) return;
    const interval = window.setInterval(() => {
      setFadeOpacity((prev) => (prev > 50 ? 0 : 100));
    }, 600);
    return () => window.clearInterval(interval);
  }, [blinking]);

  return (
    <div className="split-viewer">
      <div className="split-viewer__toolbar" role="toolbar" aria-label="Modos de inspección comparativa">
        <div className="split-viewer__modes">
          <Button
            shape={mode === 'slider' ? 'solid' : 'outline'}
            tone={mode === 'slider' ? 'primary' : 'neutral'}
            icon={<SlidersHorizontal size={16} />}
            aria-pressed={mode === 'slider'}
            onClick={() => { setMode('slider'); setBlinking(false); }}
          >
            Cortinilla (Split)
          </Button>
          <Button
            shape={mode === 'fade' ? 'solid' : 'outline'}
            tone={mode === 'fade' ? 'primary' : 'neutral'}
            icon={<Layers size={16} />}
            aria-pressed={mode === 'fade'}
            onClick={() => setMode('fade')}
          >
            Alternancia (Fade)
          </Button>
          <Button
            shape={mode === 'side-by-side' ? 'solid' : 'outline'}
            tone={mode === 'side-by-side' ? 'primary' : 'neutral'}
            icon={<Columns2 size={16} />}
            aria-pressed={mode === 'side-by-side'}
            onClick={() => { setMode('side-by-side'); setBlinking(false); }}
          >
            Lado a lado
          </Button>
        </div>

        {mode === 'fade' && (
          <div className="split-viewer__fade-controls">
            <label className="range-control">
              Mezcla
              <input
                type="range"
                min="0"
                max="100"
                value={fadeOpacity}
                aria-label="Porcentaje de mezcla del resultado sobre el original"
                onChange={(e) => {
                  setBlinking(false);
                  setFadeOpacity(Number(e.target.value));
                }}
              />
              <span>{fadeOpacity}%</span>
            </label>
            <Button
              shape={blinking ? 'solid' : 'outline'}
              tone={blinking ? 'primary' : 'neutral'}
              icon={blinking ? <EyeOff size={16} /> : <Eye size={16} />}
              aria-pressed={blinking}
              onClick={() => setBlinking((prev) => !prev)}
            >
              {blinking ? 'Detener parpadeo' : 'Parpadeo (Blink)'}
            </Button>
          </div>
        )}

        {downloadCandidate && (
          <div className="split-viewer__actions">
            <a className="button button--neutral button--outline text-link" href={candidateUrl + '?download=1'} download={downloadCandidate}>
              Descargar PNG
            </a>
          </div>
        )}
      </div>

      {mode === 'side-by-side' ? (
        <div className="compare-images">
          <figure className="image-panel">
            <div className="image-panel__frame">
              <img src={originalUrl} alt={labelOriginal} loading="lazy" />
            </div>
            <figcaption>
              <span>{labelOriginal}</span>
            </figcaption>
          </figure>
          <figure className="image-panel">
            <div className="image-panel__frame">
              <img src={candidateUrl} alt={labelCandidate} loading="lazy" />
            </div>
            <figcaption>
              <span>{labelCandidate}</span>
            </figcaption>
          </figure>
        </div>
      ) : mode === 'fade' ? (
        <div className="split-viewer__stage split-viewer__stage--fade">
          <div className="split-viewer__layer split-viewer__layer--base">
            <img src={originalUrl} alt={labelOriginal} draggable={false} />
            <span className="split-viewer__tag split-viewer__tag--left">{labelOriginal}</span>
          </div>
          <div
            className="split-viewer__layer split-viewer__layer--overlay"
            style={{ opacity: fadeOpacity / 100 }}
          >
            <img src={candidateUrl} alt={labelCandidate} draggable={false} />
            <span className="split-viewer__tag split-viewer__tag--right">{labelCandidate}</span>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="split-viewer__stage split-viewer__stage--slider"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Base Layer: Candidate Image */}
          <div className="split-viewer__layer split-viewer__layer--candidate">
            <img src={candidateUrl} alt={labelCandidate} draggable={false} />
            <span className="split-viewer__tag split-viewer__tag--right">{labelCandidate}</span>
          </div>

          {/* Clipped Top Layer: Original Image */}
          <div
            className="split-viewer__layer split-viewer__layer--original"
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          >
            <img src={originalUrl} alt={labelOriginal} draggable={false} />
            <span className="split-viewer__tag split-viewer__tag--left">{labelOriginal}</span>
          </div>

          {/* Draggable Divider Handle */}
          <div
            className="split-viewer__divider"
            style={{ left: `${position}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Posición de cortinilla de comparación"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            onKeyDown={handleKeyDown}
          >
            <div className="split-viewer__handle">
              <span>↔</span>
            </div>
          </div>
        </div>
      )}

      <p className="split-viewer__hint muted">
        {mode === 'slider' && 'Arrastra la cortinilla central o usa las flechas del teclado para comparar el alineamiento dental exacto.'}
        {mode === 'fade' && 'Ajusta la mezcla de opacidad o activa el parpadeo para inspeccionar desplazamientos de bordes.'}
        {mode === 'side-by-side' && 'Inspección simultánea en fotogramas independientes.'}
      </p>
    </div>
  );
}
