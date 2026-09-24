import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { assetUrl } from '../../shared/domain';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'neutral' | 'danger'; shape?: 'solid' | 'outline' | 'ghost'; icon?: ReactNode;
};
export function Button({ tone = 'neutral', shape = 'outline', icon, children, className = '', onClick, disabled, ...props }: ButtonProps) {
  return <button type="button" className={'button button--' + tone + ' button--' + shape + ' ' + className} onClick={onClick} disabled={disabled || !onClick} {...props}>
    {icon}<span>{children}</span>
  </button>;
}
export function Notice({ tone, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return <div className={'notice notice--' + tone} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>;
}
export function Dialog({ open, title, children, onClose, initialCancel = false, actions, wide = false }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void;
  initialCancel?: boolean; actions?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      (initialCancel ? dialog.querySelector<HTMLElement>('[data-cancel]') : dialog.querySelector<HTMLElement>('[data-close]'))?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      trigger.current?.focus();
    }
  }, [open, initialCancel]);
  return <dialog ref={ref} className={'dialog ' + (wide ? 'dialog--wide' : '')}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClose={() => { if (open) onClose(); trigger.current?.focus(); }}
    aria-labelledby="dialog-title">
    <header className="dialog__head"><h2 id="dialog-title">{title}</h2>
      <button type="button" data-close className="icon-button" aria-label="Cerrar diálogo" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="dialog__body">{children}</div>
    {actions && <footer className="dialog__actions">{actions}</footer>}
  </dialog>;
}
export function ImagePanel({ id, assetId, label, download, className = '' }: {
  id: string; assetId: string; label: string; download?: string; className?: string;
}) {
  return <figure className={'image-panel ' + className}>
    <div className="image-panel__frame"><img src={assetUrl(id, assetId)} alt={label} loading="lazy" /></div>
    <figcaption><span>{label}</span>{download && <a className="text-link" href={assetUrl(id, assetId) + '?download=1'} download={download}>Descargar PNG</a>}</figcaption>
  </figure>;
}
