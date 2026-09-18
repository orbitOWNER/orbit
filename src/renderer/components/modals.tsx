import React, { useEffect, useMemo, useState } from 'react';
import { api, type ChannelShape } from '../lib/api';
import { desktop } from '../lib/desktop';
import { openDMWith } from '../lib/dm';
import { debounce } from '../lib/utils';
import { useAuth } from '../stores/useAuth';
import { useData } from '../stores/useData';
import { useUI } from '../stores/useUI';
import { useVoice } from '../stores/useVoice';
import { Avatar, Field, Modal } from './ui';

// ---------- Create server ----------
export function CreateServerModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const upsertServer = useData((s) => s.upsertServer);
  const upsertChannel = useData((s) => s.upsertChannel);
  const set = useUI((s) => s.set);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🪐');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ICONS = ['🪐', '🎮', '🎧', '📚', '🚀', '🌙', '⚡', '🎨'];
  return (
    <Modal title="Create a community" onClose={close}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <Field label="Community name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Study Group" maxLength={100} aria-label="Server name" />
      </Field>
      <Field label="Icon">
        <div className="icon-pick">{ICONS.map((i) => <button key={i} className={icon === i ? 'sel' : ''} onClick={() => setIcon(i)} aria-label={`Icon ${i}`}>{i}</button>)}</div>
      </Field>
      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={() => {
          setBusy(true); setError(null);
          api.createServer({ name: name.trim(), icon }).then(({ server }) => {
            upsertServer(server);
            return api.bootstrap().then((b) => {
              const ch = b.channels.filter((c) => c.serverId === server.id).sort((a, c) => a.position - c.position)[0];
              ch && upsertChannel(ch);
              set({ view: 'server', activeServerId: server.id, activeChannelId: ch?.id ?? null });
              close(); toast('success', `Welcome to ${server.name}`);
            });
          }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}>{busy ? 'Creating…' : 'Create'}</button>
      </div>
    </Modal>
  );
}

// ---------- Join via invite ----------
export function JoinServerModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const bootstrap = useData((s) => s.bootstrap);
  const set = useUI((s) => s.set);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ server?: { name: string } } | null>(null);

  useEffect(() => {
    const c = code.trim().replace(/^orbit:\/\//, '');
    if (c.length < 3) { setInfo(null); return; }
    const t = setTimeout(() => {
      api.inviteInfo(c).then((r) => setInfo({ server: r.server })).catch(() => setInfo(null));
    }, 400);
    return () => clearTimeout(t);
  }, [code]);

  return (
    <Modal title="Join with an invite" onClose={close}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <Field label="Invite code or orbit:// link">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="orbit://ab12-cd34" aria-label="Invite code" />
      </Field>
      {info?.server && <p className="muted">You are joining <b>{info.server.name}</b></p>}
      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!code.trim() || busy} onClick={() => {
          setBusy(true); setError(null);
          const c = code.trim().replace(/^orbit:\/\//, '');
          api.joinInvite(c).then(({ server }) => bootstrap().then(() => {
            set({ view: 'server', activeServerId: server.id });
            close(); toast('success', `Joined ${server.name}`);
          })).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}>{busy ? 'Joining…' : 'Join'}</button>
      </div>
    </Modal>
  );
}

// ---------- Create / edit channel ----------
export function ChannelModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const props = useUI((s) => s.modalProps);
  const activeServerId = useUI((s) => s.activeServerId);
  const channels = useData((s) => s.channels);
  const upsertChannel = useData((s) => s.upsertChannel);
  const editId = props.editId as string | undefined;
  const existing = editId ? channels.find((c) => c.id === editId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState(existing?.type ?? (props.type as string ?? 'text'));
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={existing ? 'Edit channel' : 'Create channel'} onClose={close}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="general" maxLength={100} /></Field>
      {!existing && (
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Channel type">
            <option value="text">Text</option>
            <option value="announcement">Announcement</option>
            <option value="voice">Voice</option>
            <option value="category">Category</option>
          </select>
        </Field>
      )}
      {(type === 'text' || type === 'announcement') && (
        <Field label="Topic"><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this channel about?" maxLength={1024} /></Field>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={() => {
          setBusy(true); setError(null);
          const done = (c: ChannelShape) => { upsertChannel(c); close(); toast('success', existing ? 'Channel updated' : 'Channel created'); };
          if (existing) api.patchChannel(existing.id, { name: name.trim(), topic }).then(({ channel }) => done(channel)).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
          else if (activeServerId) api.createChannel(activeServerId, { name: name.trim(), type, topic }).then(({ channel }) => done(channel)).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}>{busy ? 'Saving…' : existing ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  );
}

// ---------- Invite modal ----------
export function InviteModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const activeServerId = useUI((s) => s.activeServerId);
  const [url, setUrl] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState('25');
  const [hours, setHours] = useState('24');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Invite people" onClose={close}>
      {error && <div className="form-error" role="alert">{error}</div>}
      {!url ? (
        <>
          <Field label="Max uses"><input value={maxUses} inputMode="numeric" onChange={(e) => setMaxUses(e.target.value)} /></Field>
          <Field label="Expires after (hours, blank = never)"><input value={hours} inputMode="numeric" onChange={(e) => setHours(e.target.value)} placeholder="never" /></Field>
          <div className="modal-actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={() => {
              if (!activeServerId) return;
              setBusy(true); setError(null);
              api.createInvite(activeServerId, {
                maxUses: maxUses ? parseInt(maxUses, 10) : null,
                expiresInHours: hours ? parseFloat(hours) : undefined,
              }).then(({ invite }) => setUrl(`orbit://${invite.code}`))
                .catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
            }}>{busy ? '…' : 'Generate link'}</button>
          </div>
        </>
      ) : (
        <>
          <Field label="Share this link"><input readOnly value={url} onFocus={(e) => e.target.select()} /></Field>
          <div className="modal-actions">
            <button className="btn" onClick={() => { void navigator.clipboard?.writeText(url); toast('success', 'Invite copied'); }}>Copy link</button>
            <button className="btn primary" onClick={close}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Pinned messages ----------
export function PinsModal() {
  const close = useUI((s) => s.closeModal);
  const activeChannelId = useUI((s) => s.activeChannelId);
  const [pins, setPins] = useState<{ id: string; content: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (activeChannelId) api.pins(activeChannelId).then((r) => setPins(r.messages)).catch(() => setPins([])).finally(() => setLoading(false));
  }, [activeChannelId]);
  return (
    <Modal title="Pinned messages" onClose={close}>
      {loading ? <p className="muted">Loading…</p> : pins.length === 0 ? <p className="muted">No pins yet.</p> : pins.map((p) => (
        <div key={p.id} className="pin-row"><span>📌</span><div><div>{p.content.slice(0, 200)}</div><small className="muted">{new Date(p.createdAt).toLocaleString()}</small></div></div>
      ))}
    </Modal>
  );
}

// ---------- Profile popover ----------
export function ProfileModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const userId = useUI((s) => s.profileUserId);
  const users = useData((s) => s.users);
  const members = useData((s) => s.members);
  const roles = useData((s) => s.roles);
  const activeServerId = useUI((s) => s.activeServerId);
  const me = useAuth((s) => s.user);
  if (!userId) return null;
  const u = users[userId];
  if (!u) return null;
  const m = members.find((x) => x.serverId === activeServerId && x.userId === userId);
  const rids = (Array.isArray(m?.roleIds) ? m.roleIds : []) as string[];
  const myRoles = roles.filter((r) => rids.includes(r.id));
  return (
    <Modal title="Profile" onClose={close}>
      <div className="profile">
        <Avatar name={u.displayName} icon={u.avatar} size={72} />
        <h3>{m?.nickname ?? u.displayName}</h3>
        <p className="muted">@{u.username} • {u.status}{u.customStatus ? ` — ${u.customStatus}` : ''}</p>
        {u.bio && <p className="profile-bio">{u.bio}</p>}
        {myRoles.length > 0 && <div className="role-chips">{myRoles.map((r) => <span key={r.id} className="role-chip" style={{ borderColor: r.color, color: r.color }}>{r.name}</span>)}</div>}
        <p className="muted small">Joined Orbit {new Date(u.createdAt).toLocaleDateString()}</p>
        {userId !== me?.id && (
          <div className="modal-actions">
            <button className="btn primary sm" onClick={() => {
              close();
              openDMWith(userId).catch(() => toast('error', 'Could not open DM'));
            }}>Send message</button>
            <button className="btn sm" onClick={() => { void api.friendBlock(userId).then(() => toast('success', 'Blocked')); close(); }}>Block</button>
          </div>
        )}
        {userId === me?.id && (
          <div className="modal-actions">
            <button className="btn primary sm" onClick={() => { close(); useUI.getState().openModal('settings'); }}>Open settings</button>
            <button className="btn sm" onClick={() => { useAuth.getState().logout(); close(); toast('success', 'Signed out'); }}>Log out</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Quick switcher (Ctrl+K) ----------
export function QuickSwitcher() {
  const close = useUI((s) => s.closeModal);
  const set = useUI((s) => s.set);
  const servers = useData((s) => s.servers);
  const channels = useData((s) => s.channels);
  const dms = useData((s) => s.dms);
  const users = useData((s) => s.users);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const items = useMemo(() => {
    const needle = q.toLowerCase();
    const firstText = (sid: string) => channels.filter((c) => c.serverId === sid && (c.type === 'text' || c.type === 'announcement')).sort((a, b) => a.position - b.position)[0];
    const out: { kind: string; label: string; sub: string; go: () => void }[] = [];
    for (const s of servers) if (s.name.toLowerCase().includes(needle)) out.push({ kind: 'Server', label: s.name, sub: 'Go to server', go: () => set({ view: 'server', activeServerId: s.id, activeChannelId: firstText(s.id)?.id ?? null }) });
    for (const c of channels) {
      if (c.type === 'category' || !c.serverId) continue;
      if (!c.name.toLowerCase().includes(needle)) continue;
      out.push({ kind: c.type === 'voice' ? 'Voice' : 'Channel', label: `# ${c.name}`, sub: servers.find((s) => s.id === c.serverId)?.name ?? '', go: () => set({ view: 'server', activeServerId: c.serverId, activeChannelId: c.id }) });
    }
    for (const d of dms) {
      const ids = (Array.isArray(d.memberIds) ? d.memberIds : JSON.parse(String(d.memberIds)) as string[]);
      const label = String(d.name);
      if (!label.toLowerCase().includes(needle)) continue;
      out.push({ kind: 'DM', label, sub: ids.length + ' members', go: () => set({ view: 'home', homeTab: 'dms', activeDMId: d.id }) });
    }
    for (const u of Object.values(users)) {
      if (!(u.username.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle))) continue;
      out.push({ kind: 'User', label: u.displayName, sub: `@${u.username}`, go: () => set({ profileUserId: u.id, modal: 'profile' }) });
    }
    return out.slice(0, 25);
  }, [q, servers, channels, dms, users, set]);

  return (
    <Modal title="Quick switcher" onClose={close}>
      <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIndex(0); }} placeholder="Search channels, servers, DMs, people…"
        aria-label="Quick switcher search"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && items[index]) { items[index].go(); close(); }
        }} />
      <div className="qs-list" role="listbox">
        {items.length === 0 && <p className="muted">No matches.</p>}
        {items.map((it, i) => (
          <button key={i} role="option" aria-selected={i === index} className={i === index ? 'sel' : ''}
            onMouseEnter={() => setIndex(i)} onClick={() => { it.go(); close(); }}>
            <span className="qs-kind">{it.kind}</span><b>{it.label}</b><span className="muted">{it.sub}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Global search (Ctrl+Shift+F) ----------
export function SearchModal() {
  const close = useUI((s) => s.closeModal);
  const set = useUI((s) => s.set);
  const toast = useUI((s) => s.toast);
  const channels = useData((s) => s.channels);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ messages: { id: string; channelId: string; content: string }[]; users: { id: string; username: string; displayName: string }[]; channels: { id: string; name: string; serverId: string }[] } | null>(null);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('orbit.recent') ?? '[]') as string[]; } catch { return []; } });
  const [busy, setBusy] = useState(false);

  const run = useMemo(() => debounce((needle: string) => {
    if (needle.trim().length < 2) { setRes(null); return; }
    setBusy(true);
    api.search(needle.trim()).then((r) => {
      setRes(r as never);
      setRecent((prev) => {
        const next = [needle.trim(), ...prev.filter((x) => x !== needle.trim())].slice(0, 8);
        try { localStorage.setItem('orbit.recent', JSON.stringify(next)); } catch { /* noop */ }
        return next;
      });
    }).catch(() => toast('error', 'Search failed')).finally(() => setBusy(false));
  }, 350), [toast]);

  return (
    <Modal title="Search Orbit" onClose={close} wide>
      <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); run(e.target.value); }} placeholder="Messages, people, channels…" aria-label="Search" />
      {recent.length > 0 && !res && <div className="recent">Recent: {recent.map((r) => <button key={r} className="chip" onClick={() => { setQ(r); run(r); }}>{r}</button>)}</div>}
      {busy && <p className="muted">Searching…</p>}
      {res && (
        <div className="search-cols">
          <div>
            <h4>Messages</h4>
            {res.messages.length === 0 && <p className="muted">None.</p>}
            {res.messages.map((m) => (
              <button key={m.id} className="search-row" onClick={() => {
                const ch = channels.find((c) => c.id === m.channelId);
                if (ch?.serverId) {
                  set({ view: 'server', activeServerId: ch.serverId, activeChannelId: m.channelId, highlightId: m.id, modal: null });
                } else {
                  // DM result: open it in Home instead of a server view
                  set({ view: 'home', homeTab: 'dms', activeDMId: m.channelId, highlightId: m.id, modal: null });
                }
                setTimeout(() => set({ highlightId: null }), 4000);
              }}>
                <span>{m.content.slice(0, 120)}</span><small className="muted">Jump →</small>
              </button>
            ))}
          </div>
          <div>
            <h4>People</h4>
            {res.users.map((u) => <button key={u.id} className="search-row" onClick={() => set({ profileUserId: u.id, modal: 'profile' })}>{u.displayName} <small className="muted">@{u.username}</small></button>)}
            <h4>Channels</h4>
            {res.channels.map((c) => <button key={c.id} className="search-row" onClick={() => { set({ view: 'server', activeServerId: c.serverId, activeChannelId: c.id, modal: null }); }}># {c.name}</button>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Video grid / screen share ----------
export function VideoGrid() {
  const close = useUI((s) => s.closeModal);
  const local = useVoice((s) => s.localStream);
  const peers = useVoice((s) => s.peers);
  const users = useData((s) => s.users);
  const video = useVoice((s) => s.video);
  const sharing = useVoice((s) => s.sharing);
  const setVideo = useVoice((s) => s.setVideo);
  const setSharing = useVoice((s) => s.setSharing);
  const setMuted = useVoice((s) => s.setMuted);
  const setDeafened = useVoice((s) => s.setDeafened);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const localRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && local) localRef.current.srcObject = local;
  }, [local, video, sharing]);

  return (
    <Modal title="Video & screen share" onClose={close} wide>
      <div className="video-grid">
        <div className="video-tile">
          {local && (video || sharing)
            ? <video ref={localRef} autoPlay muted playsInline />
            : <div className="video-off">Camera off — turn it on below.<br /><small className="muted">Remote video arrives over the WebRTC signaling channel (local dev shows your preview; multi-peer needs TURN).</small></div>}
          <span className="video-label">You</span>
        </div>
        {peers.map((p) => (
          <div key={p.userId} className="video-tile">
            <div className="video-off"><Avatar name={users[p.userId]?.displayName ?? '?'} icon={users[p.userId]?.avatar} size={48} />{p.video ? 'Video connecting…' : 'Camera off'}</div>
            <span className="video-label">{users[p.userId]?.displayName ?? p.userId.slice(0, 6)}{p.sharing ? ' (sharing)' : ''}</span>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn sm" onClick={() => void setMuted(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>
        <button className="btn sm" onClick={() => void setDeafened(!deafened)}>{deafened ? 'Undeafen' : 'Deafen'}</button>
        <button className="btn sm" onClick={() => void setVideo(!video)}>{video ? 'Camera off' : 'Camera on'}</button>
        <button className="btn sm" onClick={() => void setSharing(!sharing)}>{sharing ? 'Stop sharing' : 'Share screen'}</button>
        <button className="btn primary sm" onClick={close}>Done</button>
      </div>
    </Modal>
  );
}

export function openInviteLink(code: string): void {
  void desktop.openExternal(`orbit://${code}`);
}
