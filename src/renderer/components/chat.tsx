import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_SET, MAX_MESSAGE_LENGTH } from '@shared/constants/app';
import { OrbitApiError, api, type AttachmentShape, type MsgShape, type ReactionShape } from '../lib/api';
import { desktop, notify } from '../lib/desktop';
import { renderMarkdown } from '../lib/markdown';
import { cx, formatBytes, formatTime, groupMessages, isImage } from '../lib/utils';
import { useAuth } from '../stores/useAuth';
import { useData } from '../stores/useData';
import { useOutbox, type OutboxItem } from '../stores/useOutbox';
import { useUI } from '../stores/useUI';
import { Avatar, EmptyState, Skeleton } from './ui';

// ---------- Message item ----------
export const MessageItem = memo(function MessageItem({ msg, groupStart, highlight, roleColor, displayName, avatar, dimmed }: {
  msg: MsgShape; groupStart: boolean; highlight: boolean; roleColor?: string;
  displayName: string; avatar: string | null; dimmed?: boolean;
}) {
  const me = useAuth((s) => s.user);
  const reactions = useData((s) => s.reactions[msg.id] ?? []);
  const toggleReaction = useData((s) => s.toggleReaction);
  const del = useData((s) => s.deleteMessage);
  const togglePin = useData((s) => s.togglePin);
  const openContext = useUI((s) => s.openContext);
  const set = useUI((s) => s.set);
  const toast = useUI((s) => s.toast);
  const messages = useData((s) => s.messages[msg.channelId] ?? []);
  const [confirmDel, setConfirmDel] = useState(false);

  const grouped = useMemo(() => {
    const counts = new Map<string, { emoji: string; users: string[] }>();
    for (const r of reactions) {
      const k = r.emoji;
      if (!counts.has(k)) counts.set(k, { emoji: k, users: [] });
      counts.get(k)!.users.push(r.userId);
    }
    return [...counts.values()];
  }, [reactions]);

  const replyTo = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) : undefined;

  const toolbar = [
    { icon: '😊', label: 'Add reaction', fn: () => toggleReaction(msg.id, '👍', me!.id).catch(() => toast('error', 'Reaction failed')) },
    { icon: '↩', label: 'Reply', fn: () => set({ replyToId: msg.id }) },
    { icon: '📌', label: msg.pinned ? 'Unpin' : 'Pin', fn: () => togglePin(msg.id, msg.channelId, !msg.pinned).catch(() => toast('error', 'Pin needs Manage Messages')) },
    { icon: '⧉', label: 'Copy', fn: () => { void navigator.clipboard?.writeText(msg.content).then(() => toast('success', 'Copied')); } },
    ...(me?.id === msg.authorId ? [{ icon: '✎', label: 'Edit', fn: () => set({ editingId: msg.id }) }] : []),
    ...(me?.id === msg.authorId ? [{ icon: '🗑', label: 'Delete', fn: () => setConfirmDel(true) }] : []),
  ];

  return (
    <div
      id={`msg-${msg.id}`}
      className={cx('msg', !groupStart && 'compact', highlight && 'highlight', dimmed && 'dimmed')}
      onContextMenu={(e) => {
        e.preventDefault();
        openContext(e.clientX, e.clientY, [
          { label: 'Reply', action: () => set({ replyToId: msg.id }) },
          { label: 'Copy text', action: () => { void navigator.clipboard?.writeText(msg.content); } },
          { label: msg.pinned ? 'Unpin message' : 'Pin message', action: () => { void togglePin(msg.id, msg.channelId, !msg.pinned); } },
          { label: 'Report message', action: () => { void api.report(msg.id, 'reported from context menu').then(() => toast('success', 'Reported to moderators')); } },
          ...(me?.id === msg.authorId
            ? [
              { label: 'Edit message', action: () => set({ editingId: msg.id }) },
              { label: 'Delete message', danger: true, action: () => setConfirmDel(true) },
            ]
            : []),
        ]);
      }}
    >
      {groupStart ? (
        <Avatar name={displayName} icon={avatar} size={38} />
      ) : <span className="msg-time-hover">{new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
      <div className="msg-body">
        {groupStart && (
          <div className="msg-head">
            <span className="msg-author" style={roleColor ? { color: roleColor } : undefined}>{displayName}</span>
            <span className="msg-time">{formatTime(msg.createdAt)}</span>
            {msg.editedAt && <span className="msg-edited">(edited)</span>}
            {msg.pinned && <span className="msg-pinned">📌 pinned</span>}
          </div>
        )}
        {replyTo && <div className="msg-reply">↩ {replyTo.content.slice(0, 120)}</div>}
        {msg.content && <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (a?.href) { e.preventDefault(); void desktop.openExternal(a.href); }
        }} />}
        {msg.attachments?.length > 0 && (
          <div className="msg-atts">
            {msg.attachments.map((a) => (
              <div key={a.id} className="att">
                {isImage(a.mime)
                  ? <img src={a.url} alt={a.name} loading="lazy" onClick={() => void desktop.openExternal(a.url)} />
                  : <button className="att-file" onClick={() => void desktop.openExternal(a.url)}>📎 {a.name} <span>({formatBytes(a.size)})</span></button>}
              </div>
            ))}
          </div>
        )}
        {grouped.length > 0 && (
          <div className="reactions">
            {grouped.map((g) => {
              const mine = me && g.users.includes(me.id);
              return (
                <button key={g.emoji} className={cx('reaction', mine && 'mine')} title={g.users.length + ' reacted'}
                  onClick={() => me && toggleReaction(msg.id, g.emoji, me.id).catch(() => toast('error', 'Reaction failed'))}>
                  {g.emoji} {g.users.length}
                </button>
              );
            })}
          </div>
        )}
        {confirmDel && (
          <div className="confirm-row">
            <span>Delete this message?</span>
            <button className="btn danger sm" onClick={() => del(msg.id, msg.channelId).catch(() => toast('error', 'Delete failed'))}>Delete</button>
            <button className="btn sm" onClick={() => setConfirmDel(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="msg-hover" role="toolbar" aria-label="Message actions">
        {toolbar.map((t) => <button key={t.label} title={t.label} aria-label={t.label} onClick={t.fn}>{t.icon}</button>)}
      </div>
    </div>
  );
});

// ---------- Message list (windowed + paginated) ----------
const WINDOW = 120;

export function MessageList({ channelId }: { channelId: string }) {
  const all = useData((s) => s.messages[channelId] ?? []);
  const hasMore = useData((s) => s.hasMore[channelId] ?? false);
  const loadingMore = useData((s) => s.loadingMore[channelId] ?? false);
  const load = useData((s) => s.loadMessages);
  const users = useData((s) => s.users);
  const members = useData((s) => s.members);
  const roles = useData((s) => s.roles);
  const highlightId = useUI((s) => s.highlightId);
  const activeServer = useUI((s) => s.activeServerId);
  const [failed, setFailed] = useState<string | null>(null);
  const [stickBottom, setStickBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const visible = all.length > WINDOW ? all.slice(all.length - WINDOW) : all;
  const starts = useMemo(() => groupMessages(visible), [visible]);
  const pending = useOutbox((s) => s.items.filter((i) => i.channelId === channelId));
  const retryOutbox = useOutbox((s) => s.retry);
  const removeOutbox = useOutbox((s) => s.remove);
  const me = useAuth((s) => s.user);

  useEffect(() => {
    setFailed(null);
    load(channelId).catch((e: Error) => setFailed(e.message));
  }, [channelId, load]);

  useEffect(() => {
    if (stickBottom) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [visible.length, pending.length, stickBottom, channelId]);

  useEffect(() => {
    if (highlightId) {
      document.getElementById(`msg-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightId]);

  const nameOf = (authorId: string) => {
    const m = members.find((x) => x.serverId === activeServer && x.userId === authorId);
    if (m?.nickname) return m.nickname;
    return users[authorId]?.displayName ?? users[authorId]?.username ?? 'Unknown';
  };
  const colorOf = (authorId: string) => {
    const m = members.find((x) => x.serverId === activeServer && x.userId === authorId);
    const rids = (Array.isArray(m?.roleIds) ? m!.roleIds as string[] : []);
    const rs = roles.filter((r) => rids.includes(r.id)).sort((a, b) => b.position - a.position);
    return rs[0]?.color;
  };

  if (failed) {
    return <EmptyState icon="⚠️" title="Couldn't load messages" hint={failed} action={<button className="btn" onClick={() => load(channelId).then(() => setFailed(null)).catch((e: Error) => setFailed(e.message))}>Retry</button>} />;
  }
  if (!all.length && pending.length === 0 && !hasMore && !loadingMore) {
    return <EmptyState icon="💬" title="No messages yet" hint="Start the conversation — say hello!" />;
  }

  return (
    <div
      ref={scroller}
      className="msg-list"
      role="log"
      aria-label="Messages"
      onScroll={(e) => {
        const el = e.currentTarget;
        setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        if (el.scrollTop < 60 && hasMore && !loadingMore) void load(channelId, { more: true });
      }}
    >
      {hasMore && <button className="btn ghost sm load-more" onClick={() => void load(channelId, { more: true })} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load earlier messages'}</button>}
      {loadingMore && <Skeleton lines={2} />}
      {visible.map((m, i) => (
        <MessageItem
          key={m.id}
          msg={m}
          groupStart={starts[i]}
          highlight={highlightId === m.id}
          displayName={nameOf(m.authorId)}
          avatar={users[m.authorId]?.avatar ?? null}
          roleColor={colorOf(m.authorId)}
        />
      ))}
      {pending.map((p) => (
        <PendingRow
          key={p.clientId}
          item={p}
          displayName={me?.displayName ?? 'You'}
          avatar={me?.avatar ?? null}
          onRetry={() => retryOutbox(p.clientId)}
          onCancel={() => removeOutbox(p.clientId)}
        />
      ))}
    </div>
  );
}

// ---------- Queued (offline) message row ----------
function PendingRow({ item, displayName, avatar, onRetry, onCancel }: {
  item: OutboxItem; displayName: string; avatar: string | null; onRetry: () => void; onCancel: () => void;
}) {
  return (
    <div className="msg dimmed" aria-live="polite">
      <Avatar name={displayName} icon={avatar} size={38} />
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-author">{displayName}</span>
          <span className="msg-time">{formatTime(item.createdAt)}</span>
          <span className="msg-pending">{item.status === 'failed' ? '⚠ Failed' : '⏳ Sending…'}</span>
        </div>
        {item.content && <div className="msg-content">{item.content.slice(0, 500)}</div>}
        {item.error && <div className="form-error">{item.error}</div>}
        {item.status === 'failed' && (
          <div className="confirm-row">
            <button className="btn sm" onClick={onRetry}>Retry</button>
            <button className="btn ghost sm" onClick={onCancel}>Discard</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Typing indicator ----------
export function TypingRow({ channelId }: { channelId: string }) {
  const typing = useData((s) => s.typing[channelId] ?? []);
  const users = useData((s) => s.users);
  const me = useAuth((s) => s.user);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 2500);
    return () => clearInterval(t);
  }, []);
  const fresh = typing.filter((t) => t.userId !== me?.id && Date.now() - t.at < 6000);
  if (!fresh.length) return <div className="typing-row" aria-hidden />;
  const names = fresh.slice(0, 3).map((t) => users[t.userId]?.displayName ?? 'Someone');
  return <div className="typing-row" aria-live="polite"><span className="dots"><i /><i /><i /></span> {names.join(', ')} typing…</div>;
}

// ---------- Composer ----------
export function Composer({ channelId, placeholder }: { channelId: string; placeholder: string }) {
  const me = useAuth((s) => s.user);
  const send = useData((s) => s.sendMessage);
  const users = useData((s) => s.users);
  const channels = useData((s) => s.channels);
  const members = useData((s) => s.members);
  const activeServer = useUI((s) => s.activeServerId);
  const replyToId = useUI((s) => s.replyToId);
  const editingId = useUI((s) => s.editingId);
  const set = useUI((s) => s.set);
  const toast = useUI((s) => s.toast);
  const editMessage = useData((s) => s.editMessage);
  const allMsgs = useData((s) => s.messages[channelId] ?? []);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atts, setAtts] = useState<AttachmentShape[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifUrl, setGifUrl] = useState('');
  const [suggest, setSuggest] = useState<{ kind: 'user' | 'channel'; items: { id: string; label: string }[]; index: number } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0);

  const editing = editingId ? allMsgs.find((m) => m.id === editingId) : undefined;
  useEffect(() => {
    if (editing) { setText(editing.content); box.current?.focus(); }
  }, [editing]);

  useEffect(() => { setText(''); setAtts([]); setError(null); set({ replyToId: null, editingId: null }); }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const replyMsg = replyToId ? allMsgs.find((m) => m.id === replyToId) : undefined;

  const onType = (v: string) => {
    setText(v);
    // autocomplete triggers
    const m = v.match(/(^|\s)([@#])([a-zA-Z0-9_.]*)$/);
    if (m) {
      const kind = m[2] === '@' ? 'user' : 'channel';
      const q = m[3].toLowerCase();
      if (kind === 'user') {
        const pool = activeServer
          ? members.filter((x) => x.serverId === activeServer).map((x) => ({ id: x.userId, label: users[x.userId]?.username ?? x.userId }))
          : Object.values(users).map((u) => ({ id: u.id, label: u.username }));
        setSuggest({ kind, items: pool.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 6), index: 0 });
      } else {
        setSuggest({ kind, items: channels.filter((c) => c.serverId === activeServer).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6).map((c) => ({ id: c.id, label: c.name })), index: 0 });
      }
    } else setSuggest(null);
    // typing event (throttled 3s)
    if (Date.now() - typingAt.current > 3000) {
      typingAt.current = Date.now();
      void api.typing(channelId).catch(() => undefined);
    }
  };

  const applySuggest = (item: { label: string }) => {
    setText((t) => t.replace(/([@#])[a-zA-Z0-9_.]*$/, `$1${item.label} `));
    setSuggest(null);
    box.current?.focus();
  };

  const doSend = async () => {
    if ((!text.trim() && atts.length === 0) || sending) return;
    if (text.length > MAX_MESSAGE_LENGTH) { setError(`Keep it under ${MAX_MESSAGE_LENGTH} characters`); return; }
    setSending(true); setError(null);
    try {
      if (editing) {
        await editMessage(editing.id, channelId, text);
        set({ editingId: null });
      } else {
        await send(channelId, text, { replyTo: replyToId, attachments: atts });
        set({ replyToId: null });
      }
      setText(''); setAtts([]);
    } catch (e) {
      if (!editing && e instanceof OrbitApiError && e.status === 0) {
        // Offline: queue locally, flush automatically on reconnect.
        // The server dedupes by clientId, so retries never double-post.
        useOutbox.getState().enqueue({ channelId, content: text, replyTo: replyToId, attachments: atts });
        set({ replyToId: null });
        setText(''); setAtts([]);
        toast('info', 'Offline — message queued, sends on reconnect');
      } else {
        const msg = e instanceof Error ? e.message : 'Send failed';
        setError(msg);
        notify('Orbit — send failed', msg);
      }
    } finally { setSending(false); }
  };

  const attachFiles = (files: FileList | File[]) => {
    const arr = [...files].slice(0, 10 - atts.length);
    for (const f of arr) {
      if (f.size > 25 * 1024 * 1024) { setError(`${f.name}: over 25 MB`); continue; }
      setProgress(5);
      const reader = new FileReader();
      reader.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90)); };
      reader.onload = () => {
        setAtts((a) => [...a, { id: `${Date.now()}-${f.name}`, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, url: String(reader.result) }]);
        setProgress(null);
      };
      reader.onerror = () => { setError(`Couldn't read ${f.name}`); setProgress(null); };
      reader.readAsDataURL(f);
    }
  };

  return (
    <div className="composer-wrap">
      <TypingRow channelId={channelId} />
      {replyMsg && <div className="reply-bar">Replying to <b>{replyMsg.content.slice(0, 80)}</b><button onClick={() => set({ replyToId: null })} aria-label="Cancel reply">✕</button></div>}
      {editing && <div className="reply-bar">Editing message<button onClick={() => { set({ editingId: null }); setText(''); }} aria-label="Cancel edit">✕</button></div>}
      {atts.length > 0 && (
        <div className="att-bar">
          {atts.map((a) => (
            <span key={a.id} className="att-chip">{a.name} ({formatBytes(a.size)})<button onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))} aria-label={`Remove ${a.name}`}>✕</button></span>
          ))}
        </div>
      )}
      {progress !== null && <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>}
      {suggest && suggest.items.length > 0 && (
        <div className="suggest" role="listbox">
          {suggest.items.map((it, i) => (
            <button key={it.id} role="option" aria-selected={i === suggest.index} className={cx(i === suggest.index && 'sel')}
              onClick={() => applySuggest(it)} onMouseEnter={() => setSuggest({ ...suggest, index: i })}>
              {suggest.kind === 'user' ? '@' : '#'}{it.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) attachFiles(e.dataTransfer.files); }}
      >
        <label className="icon-btn" title="Attach file" aria-label="Attach file">＋<input type="file" hidden multiple onChange={(e) => { if (e.target.files) attachFiles(e.target.files); e.target.value = ''; }} /></label>
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Message input"
          onChange={(e) => onType(e.target.value)}
          onPaste={(e) => {
            const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (imgs.length) { e.preventDefault(); attachFiles(imgs); }
          }}
          onKeyDown={(e) => {
            if (suggest && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setSuggest({ ...suggest, index: (suggest.index + (e.key === 'ArrowDown' ? 1 : -1) + suggest.items.length) % suggest.items.length });
            } else if (suggest && (e.key === 'Tab' || e.key === 'Enter') && suggest.items.length) {
              e.preventDefault(); applySuggest(suggest.items[suggest.index]);
            } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void doSend(); }
            else if (e.key === 'ArrowUp' && !text && !editing) {
              const mine = [...allMsgs].reverse().find((m) => m.authorId === me?.id);
              if (mine) set({ editingId: mine.id });
            } else if (e.key === 'Escape' && editing) { set({ editingId: null }); setText(''); }
          }}
        />
        <button className="icon-btn" title="GIF (paste a link)" aria-label="Insert GIF" onClick={() => setShowGif((v) => !v)}>GIF</button>
        <button className="icon-btn" title="Emoji" aria-label="Emoji picker" onClick={() => setShowEmoji((v) => !v)}>😊</button>
        <button className="btn primary sm" onClick={() => void doSend()} disabled={sending || (!text.trim() && !atts.length)} aria-label="Send message">
          {sending ? '…' : editing ? 'Save' : 'Send'}
        </button>
      </div>
      {text.length > 1500 && <div className="char-count" aria-live="polite">{text.length}/{MAX_MESSAGE_LENGTH}</div>}
      {error && <div className="form-error" role="alert">{error} <button className="btn ghost sm" onClick={() => void doSend()}>Retry</button></div>}
      {showEmoji && (
        <div className="emoji-pop" role="dialog" aria-label="Emoji picker">
          {EMOJI_SET.map((e) => <button key={e} onClick={() => { setText((t) => t + e); setShowEmoji(false); box.current?.focus(); }}>{e}</button>)}
        </div>
      )}
      {showGif && (
        <div className="gif-pop" role="dialog" aria-label="Insert GIF from link">
          <input value={gifUrl} onChange={(e) => setGifUrl(e.target.value)} placeholder="Paste a GIF image URL…" aria-label="GIF URL" />
          <button className="btn primary sm" onClick={() => {
            if (!gifUrl.trim()) return;
            setAtts((a) => [...a, { id: `${Date.now()}-gif`, name: 'gif.gif', mime: 'image/gif', size: 0, url: gifUrl.trim() }]);
            setGifUrl(''); setShowGif(false);
            toast('success', 'GIF attached');
          }}>Attach</button>
        </div>
      )}
    </div>
  );
}

export type { ReactionShape };
