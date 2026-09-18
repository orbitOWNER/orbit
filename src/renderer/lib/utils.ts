export function avatarColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hues = [222, 262, 172, 24, 330, 200, 140, 280];
  return `hsl(${hues[h % hues.length]} 45% 42%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): (...a: Parameters<T>) => void {
  let t: number | undefined;
  return (...a: Parameters<T>) => { window.clearTimeout(t); t = window.setTimeout(() => fn(...(a as never[])), ms); };
}

export function groupMessages<T extends { authorId: string; createdAt: string }>(msgs: T[], gapMin = 5): boolean[] {
  // returns true if message starts a new visual group
  return msgs.map((m, i) => {
    if (i === 0) return true;
    const p = msgs[i - 1];
    if (p.authorId !== m.authorId) return true;
    return new Date(m.createdAt).getTime() - new Date(p.createdAt).getTime() > gapMin * 60_000;
  });
}

export function isImage(mime: string): boolean { return mime.startsWith('image/'); }
