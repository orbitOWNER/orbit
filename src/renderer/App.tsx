import React, { useEffect } from 'react';
import { api, type ChannelShape, type MsgShape, type ReactionShape, type ServerShape, type UserShape, type VoiceStateShape } from './lib/api';
import { desktop } from './lib/desktop';
import { onEvent } from './lib/realtime';
import { useAuth } from './stores/useAuth';
import { useData } from './stores/useData';
import { useSettings, applySettingsToDom } from './stores/useSettings';
import { useUI } from './stores/useUI';
import { useVoice } from './stores/useVoice';
import { useOutbox } from './stores/useOutbox';
import { useUpdates } from './stores/useUpdates';
import { AuthPage } from './features/auth/Auth';
import { Home } from './features/friends/home';
import { Composer, MessageList } from './components/chat';
import { ChannelHeader, ChannelSidebar, MemberPanel, ServerBar } from './components/sidebar';
import { ContextMenu, EmptyState, Skeleton, Toasts, UpdateBanner } from './components/ui';
import { ChannelModal, CreateServerModal, InviteModal, JoinServerModal, PinsModal, ProfileModal, QuickSwitcher, SearchModal, VideoGrid } from './components/modals';
import { ServerSettingsModal, SettingsModal } from './components/settings';

function useRealtime() {
  useEffect(() => {
    const offs = [
      onEvent<MsgShape>('MESSAGE_CREATE', (m) => {
        const st = useData.getState();
        st.upsertMessage(m);
        const me = useAuth.getState().user;
        const ui = useUI.getState();
        const isActive = ui.activeChannelId === m.channelId || ui.activeDMId === m.channelId;
        const mutedCh = st.mutedChannels[m.channelId] ?? false;
        const ch = st.channels.find((c) => c.id === m.channelId);
        const mutedSrv = ch?.serverId ? st.mutedServers[ch.serverId] : false;
        const settings = useSettings.getState();
        if (me && m.authorId !== me.id) {
          if (isActive && !document.hidden) st.markRead(m.channelId, m.id);
          else st.bumpUnread(m.channelId, m, me.id, mutedCh || mutedSrv || false);
          const mentioned = m.content.toLowerCase().includes(`@${me.username.toLowerCase()}`) || m.content.includes('@everyone');
          const isDM = !ch?.serverId;
          if ((mentioned || isDM) && !settings.dnd && settings.desktopNotifications && !mutedCh && !(mutedSrv && !mentioned)) {
            const author = st.users[m.authorId]?.displayName ?? 'Someone';
            desktop.notify(`Orbit — ${author}`, m.content.slice(0, 200));
          }
        }
      }),
      onEvent<MsgShape>('MESSAGE_UPDATE', (m) => useData.getState().upsertMessage(m)),
      onEvent<{ id: string; channelId: string }>('MESSAGE_DELETE', (d) => useData.getState().removeMessage(d.id, d.channelId)),
      onEvent<ReactionShape>('REACTION_ADD', (r) => useData.getState().upsertReaction(r)),
      onEvent<{ messageId: string; userId: string; emoji: string }>('REACTION_REMOVE', (r) => useData.getState().removeReaction(r.messageId, r.userId, r.emoji)),
      onEvent<{ channelId: string; userId: string }>('TYPING_START', (t) => useData.getState().addTyping(t.channelId, t.userId)),
      onEvent<{ userId: string; status: string }>('PRESENCE_UPDATE', (p) => {
        const u = useData.getState().users[p.userId];
        if (u) useData.getState().upsertUser({ ...u, status: p.status } as UserShape);
      }),
      onEvent<ChannelShape>('CHANNEL_CREATE', (c) => useData.getState().upsertChannel(c)),
      onEvent<ChannelShape>('CHANNEL_UPDATE', (c) => useData.getState().upsertChannel(c)),
      onEvent<{ id: string }>('CHANNEL_DELETE', (c) => useData.getState().removeChannel(c.id)),
      onEvent<ServerShape>('SERVER_CREATE', (s) => useData.getState().upsertServer(s)),
      onEvent<ServerShape>('SERVER_UPDATE', (s) => useData.getState().upsertServer(s)),
      onEvent<{ id: string }>('SERVER_DELETE', (s) => useData.getState().removeServer(s.id)),
      onEvent<{ serverId: string; userId: string }>('MEMBER_JOIN', (m) => useData.getState().memberJoin(m.serverId, m.userId)),
      onEvent<{ serverId: string; userId: string }>('MEMBER_LEAVE', (m) => useData.getState().memberLeave(m.serverId, m.userId)),
      onEvent<VoiceStateShape & { userId: string }>('VOICE_STATE_UPDATE', (v) => {
        if ((v as { relay?: boolean }).relay) return; // SDP/ICE relay handled by voice engine peers
        useVoice.getState().applyRemote(v.userId, v);
      }),
      onEvent('FRIEND_UPDATE', () => { void useData.getState().refreshFriends(); }),
    ];
    // Update status listener
    const offUpdate = desktop.onUpdateStatus((status, data) => {
      useUpdates.getState().setStatus(status as any, data as any);
    });
    return () => { offs.forEach((off) => off()); offUpdate(); };
  }, []);
}

function useGlobalKeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useUI.getState().openModal('quickSwitcher'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); useUI.getState().openModal('search'); }
      else if (mod && e.key === ',') { e.preventDefault(); useUI.getState().openModal('settings'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); const v = useVoice.getState(); if (v.channelId) void v.setMuted(!v.muted); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); const v = useVoice.getState(); if (v.channelId) void v.setDeafened(!v.deafened); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => desktop.onShortcut((id) => {
    const v = useVoice.getState();
    if (!v.channelId) return;
    if (id === 'mute') void v.setMuted(!v.muted);
    if (id === 'deafen') void v.setDeafened(!v.deafened);
  }), []);

  useEffect(() => desktop.onDeepLink((code) => {
    const ui = useUI.getState();
    ui.toast('info', `Joining invite ${code}…`);
    api.joinInvite(code)
      .then(({ server }) => useData.getState().bootstrap().then(() => {
        ui.set({ view: 'server', activeServerId: server.id });
        ui.toast('success', `Joined ${server.name}`);
      }))
      .catch(() => ui.toast('error', 'Invalid or expired invite'));
  }), []);
}

function ServerView() {
  const activeServerId = useUI((s) => s.activeServerId);
  const activeChannelId = useUI((s) => s.activeChannelId);
  const memberPanelOpen = useUI((s) => s.memberPanelOpen);
  const set = useUI((s) => s.set);
  const openModal = useUI((s) => s.openModal);
  const channels = useData((s) => s.channels);
  const load = useData((s) => s.loadMessages);
  const ready = useData((s) => s.ready);
  const ch = channels.find((c) => c.id === activeChannelId);

  useEffect(() => {
    if (activeChannelId) {
      load(activeChannelId).catch(() => undefined);
      const msgs = useData.getState().messages[activeChannelId] ?? [];
      const last = msgs[msgs.length - 1];
      if (last) useData.getState().markRead(activeChannelId, last.id);
    }
  }, [activeChannelId, load]);

  if (!ready) return <div className="main-pane"><Skeleton lines={6} /></div>;
  if (!activeServerId) return <div className="main-pane"><EmptyState icon="🪐" title="Select a community" hint="Pick a server on the left, or create your own." /></div>;

  return (
    <>
      <ChannelSidebar />
      <div className="main-pane">
        <ChannelHeader onSearch={() => openModal('search')} onToggleMembers={() => set({ memberPanelOpen: !memberPanelOpen })} />
        {ch && ch.type !== 'voice' ? (
          <>
            <MessageList channelId={ch.id} />
            <Composer channelId={ch.id} placeholder={`Message #${ch.name}`} />
          </>
        ) : ch?.type === 'voice' ? (
          <EmptyState icon="🔊" title={`${ch.name} — voice`} hint="You joined voice. Open video & screen controls from the connection bar." />
        ) : (
          <EmptyState icon="#" title="No channel selected" hint="Choose a channel from the sidebar." />
        )}
      </div>
      {memberPanelOpen && <MemberPanel />}
    </>
  );
}

function Modals() {
  const modal = useUI((s) => s.modal);
  switch (modal) {
    case 'settings': return <SettingsModal />;
    case 'serverSettings': return <ServerSettingsModal />;
    case 'createServer': return <CreateServerModal />;
    case 'joinServer': return <JoinServerModal />;
    case 'createChannel': return <ChannelModal />;
    case 'invite': return <InviteModal />;
    case 'pins': return <PinsModal />;
    case 'profile': return <ProfileModal />;
    case 'quickSwitcher': return <QuickSwitcher />;
    case 'search': return <SearchModal />;
    case 'videoGrid': return <VideoGrid />;
    default: return null;
  }
}

export function App() {
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  const init = useAuth((s) => s.init);
  const bootstrap = useData((s) => s.bootstrap);
  const dataReady = useData((s) => s.ready);
  const dataError = useData((s) => s.error);
  const view = useUI((s) => s.view);
  const settings = useSettings();

  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    // Restore the offline outbox, then flush anything still queued.
    useOutbox.getState().load().then(() => useOutbox.getState().flush()).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (user && !dataReady) bootstrap().catch(() => undefined);
  }, [user, dataReady, bootstrap]);
  useEffect(() => { applySettingsToDom(settings); }, [settings]);
  useRealtime();
  useGlobalKeys();

  if (status === 'idle' || status === 'loading') {
    return <div className="boot"><span className="orbit-mark lg">◍</span><p>Starting Orbit…</p></div>;
  }
  if (status === 'offline' && !user) {
    return (
      <div className="boot">
        <span className="orbit-mark lg">◍</span>
        <p>Couldn't reach the Orbit service. Your login is saved — just retry.</p>
        <button className="btn primary" onClick={() => void init()}>Retry</button>
        <button className="btn ghost sm" onClick={() => useAuth.getState().logout()}>Switch account</button>
        <Toasts /><ContextMenu />
      </div>
    );
  }
  if (!user) return (<><AuthPage /><Toasts /><ContextMenu /></>);

  return (
    <div className="shell">
      <ServerBar />
      {view === 'home' ? <Home /> : <ServerView />}
      <Modals />
      <Toasts />
      <ContextMenu />
      <UpdateBanner />
      {dataError && !dataReady && (
        <div className="banner-error" role="alert">
          {dataError} <button className="btn sm" onClick={() => bootstrap().catch(() => undefined)}>Retry</button>
        </div>
      )}
    </div>
  );
}
