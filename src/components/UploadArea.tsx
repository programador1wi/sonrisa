import { useRef, useState } from 'react';
import { ArrowUpFromLine, ImagePlus, X } from 'lucide-react';
import { Button, Notice } from './ui';
import { MAX_UPLOAD_BYTES } from '../../shared/domain';
import { uploadPhoto } from '../api';
import type { Simulation } from '../../shared/domain';

export function UploadArea({ onUploaded }: { onUploaded: (sim: Simulation) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState<File | null>(null);
  const [error, setError] = useState('');
  const choose = (file?: File) => {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Selecciona una fotografía JPEG o PNG.'); return; }
    if (!file.size || file.size > MAX_UPLOAD_BYTES) { setError('El archivo debe medir entre 1 byte y 20 MB.'); return; }
    setSelected(file);
  };
  const upload = async () => {
    if (!selected || uploading) return;
    setUploading(true); setProgress(0); setError('');
    const controller = new AbortController();
    abort.current = controller;
    try { onUploaded(await uploadPhoto(selected, setProgress, controller.signal)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar la fotografía.'); }
    finally { setUploading(false); abort.current = null; }
  };
  return <section className="upload-card" aria-labelledby="upload-title">
    <div className="upload-card__icon"><ImagePlus size={28} strokeWidth={1.5} /></div>
    <p className="eyebrow">Nueva simulación</p>
    <h2 id="upload-title">Empieza con la fotografía original.</h2>
    <p className="muted">Selecciona una fotografía con dientes visibles. La primera etapa conservará el archivo exactamente como lo cargaste.</p>
    <div className={'dropzone ' + (drag ? 'dropzone--active' : '')}
      onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrag(false); }}
      onDrop={(event) => { event.preventDefault(); setDrag(false); choose(event.dataTransfer.files[0]); }}>
      <ArrowUpFromLine size={24} aria-hidden="true" />
      <div><strong>Arrastra tu fotografía aquí</strong><p>JPEG o PNG · hasta 20 MB</p></div>
      <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png" aria-label="Seleccionar fotografía"
        onChange={(event) => choose(event.target.files?.[0])} />
      <Button onClick={() => input.current?.click()} disabled={uploading}>Elegir archivo</Button>
    </div>
    {selected && <div className="selected-file"><span><strong>{selected.name}</strong><small>{(selected.size / 1024 / 1024).toFixed(1)} MB</small></span>
      {!uploading && <button type="button" className="icon-button" aria-label="Quitar archivo" onClick={() => { setSelected(null); if (input.current) input.current.value = ''; }}><X size={18} /></button>}
    </div>}
    {uploading && <div className="upload-progress" role="status" aria-live="polite"><div className="upload-progress__rail"><span style={{ width: progress + '%' }} /></div><span>Cargando {progress} %</span>
      <Button shape="ghost" onClick={() => abort.current?.abort()}>Cancelar carga</Button></div>}
    {error && <Notice tone="danger">{error}</Notice>}
    <Button tone="primary" shape="solid" disabled={!selected || uploading} onClick={() => { void upload(); }}>Crear simulación</Button>
  </section>;
}
