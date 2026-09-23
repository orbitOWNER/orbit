import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { avatarColor, cx, initials } from '../lib/utils';
import { useUI } from '../stores/useUI';
import { useUpdates } from '../stores/useUpdates';

export function Avatar({ name, icon, size = 36, color, speaking, muted }: {
  name: string; icon?: string | null; size?: number; color?: string; speaking?: boolean; muted?: boolean;
}) {
  const bg = color ?? avatarColor(name);
  const isImg = !!icon && (icon.startsWith('data:') || icon.startsWith('http'));
  return (
    <span
      className={cx('avatar', speaking && 'speaking')}
      style={{ width: size, height: size, fontSize: size * 0.42, background: isImg ? 'transparent' : icon ? 'var(--bg-soft)' : bg }}
      aria-hidden
    >
      {isImg
        ? <img src={icon as string} alt="" draggable={false} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
        : (icon ?? initials(name))}
      {muted && <span className="avatar-muted" title="Muted">✕</span>}
    </span>
  );
}

export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="tip" data-tip={label} tabIndex={0}>{children}</span>;
}

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={cx('toast', t.kind)} onClick={() => dismiss(t.id)}>{t.text}</button>
      ))}
    </div>,
    document.body,
  );
}

export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu);
  const close = useUI((s) => s.closeContext);
  useEffect(() => {
    if (!menu) return;
    const h = () => close();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('click', h); window.removeEventListener('keydown', k); };
  }, [menu, close]);
  if (!menu) return null;
  return createPortal(
    <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 200) }} role="menu">
      {menu.items.map((it, i) => (
        <button key={i} role="menuitem" className={cx('ctx-item', it.danger && 'danger')} onClick={(e) => { e.stopPropagation(); close(); it.action(); }}>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="sk-line" style={{ width: `${92 - i * 9}%` }} />)}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} className={cx('toggle', checked && 'on')} onClick={() => onChange(!checked)} aria-label={label}>
      <span className="knob" />
    </button>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function UpdateBanner() {
  const { status, info, progress, quitAndInstall, checkForUpdates } = useUpdates();
  if (status === 'idle' || status === 'not-available') return null;
  if (status === 'checking') {
    return (
      <div className="update-banner checking" role="status">
        <span>Checking for updates…</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="update-banner error" role="alert">
        <span>Update check failed — will retry automatically.</span>
        <button className="btn ghost sm" onClick={() => void checkForUpdates()}>Retry now</button>
        <button className="btn ghost sm" onClick={() => useUpdates.getState().setStatus('idle')}>Dismiss</button>
      </div>
    );
  }
  if (status === 'downloaded') {
    return (
      <div className="update-banner downloaded" role="alert">
        <span>Update to v{info?.version} ready — restart to install.</span>
        <button className="btn primary sm" onClick={() => quitAndInstall()}>Restart now</button>
        <button className="btn ghost sm" onClick={() => useUpdates.getState().setStatus('idle')}>Later</button>
      </div>
    );
  }
  if (status === 'available') {
    return (
      <div className="update-banner available" role="status">
        <span>Update v{info?.version} available — downloading…</span>
        <button className="btn ghost sm" onClick={() => useUpdates.getState().setStatus('idle')}>Dismiss</button>
      </div>
    );
  }
  if (status === 'downloading') {
    return (
      <div className="update-banner downloading" role="progressbar" aria-valuenow={progress ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <span>Downloading update v{info?.version}… {progress !== null ? `${progress}%` : ''}</span>
        <div className="update-progress"><i style={{ width: `${progress ?? 0}%` }} /></div>
      </div>
    );
  }
  return null;
}
