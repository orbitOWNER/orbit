import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/utils';
import { useAuth } from '../stores/useAuth';
import { useData } from '../stores/useData';
import { useUI } from '../stores/useUI';
import { useVoice } from '../stores/useVoice';
import { Avatar, Tip } from './ui';

// ---------- Left server bar ----------
export function ServerBar() {
  const servers = useData((s) => s.servers);
  const activeServerId = useUI((s) => s.activeServerId);
  const view = useUI((s) => s.view);
  const set = useUI((s) => s.set);
  const openModal = useUI((s) => s.openModal);
  const openContext = useUI((s) => s.openContext);
  const toast = useUI((s) => s.toast);
  const read = useData((s) => s.read);
  const mutedServers = useData((s) => s.mutedServers);
  const channels = useData((s) => s.channels);
  const toggleMuteServer = useData((s) => s.toggleMuteServer);
  const removeServer = useData((s) => s.removeServer);
  const markRead = useData((s) => s.markRead);

  const unreadFor = (sid: string) => channels
    .filter((c) => c.serverId === sid)
    .reduce((a, c) => a + (read[c.id]?.unread ?? 0), 0);

  const goHome = () => set({ view: 'home', activeServerId: null, activeChannelId: null });

  return (
    <nav className="server-bar" aria-label="Servers">
      <Tip label="Home">
        <button className={cx('server-icon home', view === 'home' && 'active')} onClick={goHome} aria-label="Home">
          <span className="orbit-mark" aria-hidden>◍</span>
        </button>
      </Tip>
      <div className="server-sep" />
      {servers.map((s) => (
        <div key={s.id} className="server-slot">
          {activeServerId === s.id && <span className="active-pill" />}
          <Tip label={s.name}>
            <button
              className={cx('server-icon', activeServerId === s.id && 'active', mutedServers[s.id] && 'muted')}
              onClick={() => {
                const first = channels.filter((c) => c.serverId === s.id && (c.type === 'text' || c.type === 'announcement')).sort((a, b) => a.position - b.position)[0];
                set({ view: 'server', activeServerId: s.id, activeChannelId: first?.id ?? null });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openContext(e.clientX, e.clientY, [
                  { label: 'Mark as read', action: () => channels.filter((c) => c.serverId === s.id).forEach((c) => markRead(c.id, null)) },
                  { label: mutedServers[s.id] ? 'Unmute server' : 'Mute server', action: () => toggleMuteServer(s.id) },
                  { label: 'Server settings', action: () => { set({ activeServerId: s.id, view: 'server' }); openModal('serverSettings'); } },
                  { label: 'Invite people', action: () => { set({ activeServerId: s.id, view: 'server' }); openModal('invite'); } },
                  {
                    label: 'Leave server', danger: true, action: () => {
                      if (!confirm(`Leave "${s.name}"?`)) return;
                      api.leaveServer(s.id).then(() => {
                        removeServer(s.id);
                        set({ view: 'home', activeServerId: null, activeChannelId: null, homeTab: 'friends' });
                        toast('success', `Left ${s.name}`);
                      }).catch(() => toast('error', 'Could not leave (owners must delete instead)'));
                    },
                  },
                ]);
              }}
              aria-label={s.name}
            >
              {s.icon ?? s.name.slice(0, 1).toUpperCase()}
              {unreadFor(s.id) > 0 && !mutedServers[s.id] && <span className="server-badge">{unreadFor(s.id)}</span>}
            </button>
          </Tip>
        </div>
      ))}
      <Tip label="Add a server">
        <button className="server-icon add" onClick={() => openModal('createServer')} aria-label="Add server">＋</button>
      </Tip>
      <Tip label="Explore">
        <button className="server-icon add" onClick={() => openModal('joinServer')} aria-label="Join with invite">🧭</button>
      </Tip>
    </nav>
  );
}

// ---------- Channel sidebar ----------
export function ChannelSidebar() {
  const activeServerId = useUI((s) => s.activeServerId);
  const activeChannelId = useUI((s) => s.activeChannelId);
  const set = useUI((s) => s.set);
  const openModal = useUI((s) => s.openModal);
  const openContext = useUI((s) => s.openContext);
  const toast = useUI((s) => s.toast);
  const servers = useData((s) => s.servers);
  const channels = useData((s) => s.channels);
  const upsertChannel = useData((s) => s.upsertChannel);
  const read = useData((s) => s.read);
  const mutedChannels = useData((s) => s.mutedChannels);
  const toggleMuteChannel = useData((s) => s.toggleMuteChannel);
  const peers = useVoice((s) => s.peers);
  const voiceChannel = useVoice((s) => s.channelId);
  const joinVoice = useVoice((s) => s.join);
  const me = useAuth((s) => s.user);
  const users = useData((s) => s.users);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const server = servers.find((s) => s.id === activeServerId);
  const list = useMemo(
    () => channels.filter((c) => c.serverId === activeServerId).sort((a, b) => a.position - b.position),
    [channels, activeServerId],
  );
  const cats = useMemo(() => list.filter((c) => c.type === 'category'), [list]);
  const uncategorized = useMemo(() => list.filter((c) => c.type !== 'category' && !c.categoryId), [list]);
  if (!server) return null;

  const chRow = (c: (typeof list)[number]) => {
    const unread = read[c.id]?.unread ?? 0;
    const mentions = read[c.id]?.mentions ?? 0;
    const inVoice = peers.filter((p) => p.channelId === c.id);
    return (
      <div key={c.id}>
        <button
          className={cx('ch-row', activeChannelId === c.id && 'active', mutedChannels[c.id] && 'muted')}
          draggable
          onDragStart={() => setDragId(c.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragId || dragId === c.id) return;
            const others = list.filter((x) => x.id !== dragId);
            const toIdx = others.findIndex((x) => x.id === c.id);
            const moved = list.find((x) => x.id === dragId)!;
            others.splice(toIdx, 0, moved);
            others.forEach((x, i) => upsertChannel({ ...x, position: i }));
            void api.reorderChannels(others.map((x) => x.id)).catch(() => toast('error', 'Reorder failed'));
            setDragId(null);
          }}
          onClick={() => {
            if (c.type === 'voice') { void joinVoice(c.id).catch(() => toast('error', 'Could not join voice')); return; }
            set({ activeChannelId: c.id });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openContext(e.clientX, e.clientY, [
              { label: 'Open channel', action: () => set({ activeChannelId: c.id }) },
              { label: mutedChannels[c.id] ? 'Unmute channel' : 'Mute channel', action: () => toggleMuteChannel(c.id) },
              { label: 'Edit channel', action: () => openModal('createChannel', { editId: c.id }) },
              { label: 'Delete channel', danger: true, action: () => { void api.deleteChannel(c.id).catch(() => toast('error', 'Delete needs Manage Channels')); } },
            ]);
          }}
          aria-label={`${c.type === 'voice' ? 'Voice' : 'Text'} channel ${c.name}`}
        >
          <span className="ch-icon">{c.type === 'voice' ? '🔊' : c.type === 'announcement' ? '📣' : '#'}</span>
          <span className="ch-name">{c.name}</span>
          {unread > 0 && !mutedChannels[c.id] && mentions === 0 && <span className="unread-dot" />}
          {mentions > 0 && <span className="mention-badge">{mentions}</span>}
          {c.type === 'voice' && voiceChannel === c.id && <span className="voice-live">●</span>}
        </button>
        {c.type === 'voice' && inVoice.length > 0 && (
          <div className="voice-users">
            {inVoice.map((p) => (
              <span key={p.userId} className="voice-user">
                <Avatar name={users[p.userId]?.displayName ?? '?'} icon={users[p.userId]?.avatar} size={18} speaking={p.speaking} muted={p.muted} />
                {users[p.userId]?.displayName ?? p.userId.slice(0, 6)}
                {p.userId === me?.id && ' (you)'}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="ch-sidebar" aria-label="Channels">
      <button className="server-head" onClick={() => openModal('serverSettings')}>
        <b>{server.name}</b><span>▾</span>
      </button>
      <div className="ch-scroll">
        <div className="ch-cat">
          <button className="ch-cat-head" onClick={() => setCollapsed((c) => ({ ...c, text: !c.text }))}>
            {collapsed.text ? '▸' : '▾'} TEXT CHANNELS <span className="ch-add" role="button" aria-label="Add text channel"
              onClick={(e) => { e.stopPropagation(); openModal('createChannel', { type: 'text' }); }}>＋</span>
          </button>
          {!collapsed.text && uncategorized.filter((c) => c.type !== 'voice').map(chRow)}
          {!collapsed.text && cats.map((cat) => (
            <div key={cat.id}>
              <button className="ch-cat-head sub" onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }))}>
                {collapsed[cat.id] ? '▸' : '▾'} {cat.name.toUpperCase()}
              </button>
              {!collapsed[cat.id] && list.filter((c) => c.categoryId === cat.id).map(chRow)}
            </div>
          ))}
        </div>
        <div className="ch-cat">
          <button className="ch-cat-head" onClick={() => setCollapsed((c) => ({ ...c, voice: !c.voice }))}>
            {collapsed.voice ? '▸' : '▾'} VOICE CHANNELS <span className="ch-add" role="button" aria-label="Add voice channel"
              onClick={(e) => { e.stopPropagation(); openModal('createChannel', { type: 'voice' }); }}>＋</span>
          </button>
          {!collapsed.voice && uncategorized.filter((c) => c.type === 'voice').map(chRow)}
        </div>
      </div>
      <VoiceMini />
      <UserMini />
    </aside>
  );
}

function VoiceMini() {
  const channelId = useVoice((s) => s.channelId);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const connecting = useVoice((s) => s.connecting);
  const leave = useVoice((s) => s.leave);
  const setMuted = useVoice((s) => s.setMuted);
  const setDeafened = useVoice((s) => s.setDeafened);
  const channels = useData((s) => s.channels);
  const openModal = useUI((s) => s.openModal);
  if (!channelId) return null;
  const ch = channels.find((c) => c.id === channelId);
  return (
    <div className="voice-mini" role="status" aria-label="Voice connection">
      <div>
        <div className="voice-status">{connecting ? 'Connecting…' : 'Voice connected'}</div>
        <div className="voice-ch">{ch?.name ?? channelId.slice(0, 6)}</div>
      </div>
      <Tip label={muted ? 'Unmute' : 'Mute'}><button className="icon-btn" onClick={() => void setMuted(!muted)} aria-label="Mute">{muted ? '🔇' : '🎙'}</button></Tip>
      <Tip label={deafened ? 'Undeafen' : 'Deafen'}><button className="icon-btn" onClick={() => void setDeafened(!deafened)} aria-label="Deafen">{deafened ? '🔕' : '🎧'}</button></Tip>
      <Tip label="Video & screen"><button className="icon-btn" onClick={() => openModal('videoGrid')} aria-label="Video">📹</button></Tip>
      <Tip label="Disconnect"><button className="icon-btn danger" onClick={() => void leave()} aria-label="Disconnect">✕</button></Tip>
    </div>
  );
}

function UserMini() {
  const me = useAuth((s) => s.user);
  const openModal = useUI((s) => s.openModal);
  if (!me) return null;
  return (
    <button className="user-mini" onClick={() => openModal('settings')} aria-label="User settings">
      <Avatar name={me.displayName} icon={me.avatar} size={30} />
      <span className="user-mini-name">{me.displayName}<small>{me.status}</small></span>
      <span aria-hidden>⚙</span>
    </button>
  );
}

// ---------- Channel header ----------
export function ChannelHeader({ onSearch, onToggleMembers }: { onSearch: () => void; onToggleMembers: () => void }) {
  const activeChannelId = useUI((s) => s.activeChannelId);
  const channels = useData((s) => s.channels);
  const openModal = useUI((s) => s.openModal);
  const toggleMuteChannel = useData((s) => s.toggleMuteChannel);
  const mutedChannels = useData((s) => s.mutedChannels);
  const ch = channels.find((c) => c.id === activeChannelId);
  if (!ch) return <header className="ch-header" />;
  return (
    <header className="ch-header">
      <span className="ch-icon">{ch.type === 'voice' ? '🔊' : '#'}</span>
      <b>{ch.name}</b>
      {ch.topic && <span className="ch-topic">{ch.topic}</span>}
      <span className="spacer" />
      <Tip label={mutedChannels[ch.id] ? 'Unmute channel' : 'Mute channel'}>
        <button className="icon-btn" onClick={() => toggleMuteChannel(ch.id)} aria-label="Notification settings">{mutedChannels[ch.id] ? '🔕' : '🔔'}</button>
      </Tip>
      <Tip label="Pinned messages">
        <button className="icon-btn" onClick={() => openModal('pins')} aria-label="Pinned messages">📌</button>
      </Tip>
      <Tip label="Search (Ctrl+Shift+F)">
        <button className="icon-btn" onClick={onSearch} aria-label="Search">🔍</button>
      </Tip>
      <Tip label="Members">
        <button className="icon-btn" onClick={onToggleMembers} aria-label="Toggle members">👥</button>
      </Tip>
    </header>
  );
}

// ---------- Member panel + profile ----------
export function MemberPanel() {
  const activeServerId = useUI((s) => s.activeServerId);
  const members = useData((s) => s.members);
  const users = useData((s) => s.users);
  const roles = useData((s) => s.roles);
  const set = useUI((s) => s.set);
  const list = members.filter((m) => m.serverId === activeServerId);
  const online = list.filter((m) => !['offline', 'invisible'].includes(users[m.userId]?.status ?? 'offline'));
  const offline = list.filter((m) => ['offline', 'invisible'].includes(users[m.userId]?.status ?? 'offline'));

  const row = (m: (typeof list)[number]) => {
    const u = users[m.userId];
    if (!u) return null;
    const rids = (Array.isArray(m.roleIds) ? m.roleIds : []) as string[];
    const top = roles.filter((r) => rids.includes(r.id)).sort((a, b) => b.position - a.position)[0];
    return (
      <button key={m.id} className="member-row" onClick={() => set({ profileUserId: m.userId, modal: 'profile' })}>
        <span className="presence-wrap"><Avatar name={m.nickname ?? u.displayName} icon={u.avatar} size={30} color={top?.color} /><span className={`presence ${u.status}`} /></span>
        <span className="member-name" style={top ? { color: top.color } : undefined}>{m.nickname ?? u.displayName}</span>
      </button>
    );
  };

  return (
    <aside className="member-panel" aria-label="Members">
      <h4>ONLINE — {online.length}</h4>
      {online.map(row)}
      <h4>OFFLINE — {offline.length}</h4>
      {offline.map(row)}
    </aside>
  );
}
