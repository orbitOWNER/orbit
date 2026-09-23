import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { openDMWith } from '../../lib/dm';
import { cx } from '../../lib/utils';
import { useAuth } from '../../stores/useAuth';
import { useData } from '../../stores/useData';
import { useUI } from '../../stores/useUI';
import { Composer, MessageList } from '../../components/chat';
import { Avatar, EmptyState } from '../../components/ui';

// ---------- Home: friends + DMs + owner installs ----------
export function Home() {
  const tab = useUI((s) => s.homeTab);
  const set = useUI((s) => s.set);
  const activeDMId = useUI((s) => s.activeDMId);
  const me = useAuth((s) => s.user);
  const isOwner = me?.username === 'sansOWNER';
  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'friends'} className={cx(tab === 'friends' && 'sel')} onClick={() => set({ homeTab: 'friends' })}>Friends</button>
          <button role="tab" aria-selected={tab === 'dms'} className={cx(tab === 'dms' && 'sel')} onClick={() => set({ homeTab: 'dms' })}>Messages</button>
          {isOwner && <button role="tab" aria-selected={tab === 'installs'} className={cx(tab === 'installs' && 'sel')} onClick={() => set({ homeTab: 'installs' })} title="Owner only">Installs 👑</button>}
        </div>
        {tab === 'friends' ? <FriendsPane /> : tab === 'installs' ? <InstallsPane /> : <DMListPane />}
      </aside>
      <section className="home-main">
        {tab === 'friends' ? <FriendsMain /> : tab === 'installs' ? <InstallsMain /> : activeDMId ? <DMChat dmId={activeDMId} /> : <EmptyState icon="✉" title="Pick a conversation" hint="Start a DM from a profile or the + button." />}
      </section>
    </div>
  );
}

function InstallsPane() {
  return (
    <div className="friend-side">
      <h4>OWNER — INSTALLS</h4>
      <p className="muted small">Only you can see this. Every device that has ever logged in appears here.</p>
    </div>
  );
}

function InstallsMain() {
  const [rows, setRows] = useState<null | { deviceId: string; userId: string; username: string; displayName: string; appVersion: string; platform: string; arch: string; lastSeen: string }[]>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    setErr(null);
    api.getInstalls().then((r) => setRows(r.installs)).catch((e: Error) => setErr(e.message));
  };
  useEffect(() => { refresh(); }, []);
  if (err) return <div className="friends-main"><div className="form-error" role="alert">{err}</div><button className="btn sm" onClick={refresh}>Retry</button></div>;
  if (!rows) return <div className="friends-main"><p className="muted">Loading installs…</p></div>;
  // Group by user to show you have 2 accounts, but per-device rows so both PCs appear separately
  return (
    <div className="friends-main">
      <h2>Installs 👑 <small className="muted">owner only</small></h2>
      <p className="muted small">Every PC that has reported — one row per device. Your friend on 0.3.7 and both your PCs will each appear. Updates every minute in background.</p>
      {rows.length === 0 && <p className="muted">No installs yet — open the app on another PC and it will appear.</p>}
      {rows.map((r) => (
        <div key={r.deviceId} className="friend-row">
          <Avatar name={r.displayName} size={36} />
          <div><b>{r.displayName}</b> <span className="muted">@{r.username} • v{r.appVersion} • {r.platform} {r.arch}</span><br /><small className="muted">last seen {new Date(r.lastSeen).toLocaleString()} • {r.deviceId.slice(0, 8)}</small></div>
          <span className="spacer" />
          <span className="muted small">{r.username === 'sansOWNER' || r.username === 'sansOWNER2' ? 'you' : 'friend'}</span>
        </div>
      ))}
      <button className="btn ghost sm" onClick={refresh}>Refresh</button>
    </div>
  );
}

function FriendsPane() {
  const friendships = useData((s) => s.friendships);
  const users = useData((s) => s.users);
  const me = useAuth((s) => s.user);
  const accepted = friendships.filter((f) => f.status === 'accepted');
  return (
    <div className="friend-side">
      <h4>FRIENDS — {accepted.length}</h4>
      {accepted.map((f) => {
        const u = users[f.friendId];
        if (!u) return null;
        return (
          <div key={f.id} className="member-row">
            <span className="presence-wrap"><Avatar name={u.displayName} icon={u.avatar} size={30} /><span className={`presence ${u.status}`} /></span>
            <span className="member-name">{u.displayName}<small className="muted"> @{u.username}</small></span>
          </div>
        );
      })}
      {accepted.length === 0 && <p className="muted small">No friends yet — add someone by username.</p>}
      <p className="muted small">Signed in as @{me?.username}</p>
    </div>
  );
}

function FriendsMain() {
  const friendships = useData((s) => s.friendships);
  const users = useData((s) => s.users);
  const refresh = useData((s) => s.refreshFriends);
  const toast = useUI((s) => s.toast);
  const [username, setUsername] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useAuth((s) => s.user);

  const incoming = friendships.filter((f) => f.status === 'pending' && f.userId !== me?.id);
  const outgoing = friendships.filter((f) => f.status === 'pending' && f.userId === me?.id);
  const accepted = friendships.filter((f) => f.status === 'accepted')
    .filter((f) => (users[f.friendId]?.username ?? '').toLowerCase().includes(q.toLowerCase()));

  const row = (userId: string, actions: React.ReactNode, status?: string) => {
    const u = users[userId];
    if (!u) return null;
    return (
      <div key={userId} className="friend-row">
        <Avatar name={u.displayName} icon={u.avatar} size={36} />
        <div><b>{u.displayName}</b> <span className="muted">@{u.username} • {status ?? u.status}</span></div>
        <span className="spacer" />
        {actions}
      </div>
    );
  };

  return (
    <div className="friends-main">
      <h2>Friends</h2>
      <div className="row-form">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add by username (e.g. pixel)" aria-label="Add friend by username" onKeyDown={(e) => {
          if (e.key === 'Enter' && username.trim() && !busy) {
            e.preventDefault();
            (e.target as HTMLInputElement).nextElementSibling?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }} />
        <button className="btn primary sm" disabled={!username.trim() || busy} onClick={() => {
          setBusy(true);
          api.friendRequest(username.trim()).then((r) => {
            setUsername('');
            return refresh().then(() => {
              const rr = r as unknown as { autoAccepted?: boolean };
              toast('success', rr?.autoAccepted ? 'You are now friends!' : 'Request sent');
            });
          }).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : 'Request failed';
            toast('error', msg);
          }).finally(() => setBusy(false));
        }}>Send request</button>
      </div>
      {incoming.length > 0 && (
        <>
          <h4>REQUESTS — {incoming.length}</h4>
          {incoming.map((f) => row(f.userId,
            <><button className="btn primary sm" onClick={() => { void api.friendAccept(f.userId).then(() => refresh()); }}>Accept</button>
              <button className="btn sm" onClick={() => { void api.friendRemove(f.userId).then(() => refresh()); }}>Decline</button></>))}
        </>
      )}
      {outgoing.length > 0 && <><h4>PENDING — {outgoing.length}</h4>{outgoing.map((f) => row(f.friendId, <span className="muted small">waiting…</span>))}</>}
      <h4>ALL FRIENDS — {accepted.length}</h4>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" aria-label="Search friends" className="search-input" />
      {accepted.map((f) => row(f.friendId, <>
        <button className="btn sm" onClick={() => {
          openDMWith(f.friendId).catch(() => toast('error', 'DM failed'));
        }}>Message</button>
        <button className="btn ghost sm" onClick={() => { void api.friendBlock(f.friendId).then(() => refresh()); }}>Block</button>
        <button className="btn ghost sm danger-text" onClick={() => { void api.friendRemove(f.friendId).then(() => refresh()); }}>Remove</button>
      </>))}
      {accepted.length === 0 && <p className="muted">Nothing here yet.</p>}
    </div>
  );
}

function DMListPane() {
  const dms = useData((s) => s.dms);
  const users = useData((s) => s.users);
  const activeDMId = useUI((s) => s.activeDMId);
  const set = useUI((s) => s.set);
  const openContext = useUI((s) => s.openContext);
  const me = useAuth((s) => s.user);
  const read = useData((s) => s.read);
  const toast = useUI((s) => s.toast);
  const refresh = useData((s) => s.refreshDMs);

  const nameOf = (dmId: string) => {
    const d = dms.find((x) => x.id === dmId);
    if (!d) return '?';
    const ids = (Array.isArray(d.memberIds) ? d.memberIds : JSON.parse(String(d.memberIds)) as string[]).filter((i) => i !== me?.id);
    if (d.isGroup) return d.name;
    return users[ids[0]]?.displayName ?? d.name;
  };

  return (
    <div className="dm-list">
      <div className="dm-head"><h4>DIRECT MESSAGES</h4>
        <button className="icon-btn" aria-label="New DM" onClick={() => {
          const name = prompt('Username to message:');
          if (!name) return;
          api.users(name).then((r) => {
            const u = r.users[0];
            if (!u) { toast('error', 'User not found'); return; }
            return api.createDM([u.id]).then(({ dm }) => refresh().then(() => set({ activeDMId: dm.id })));
          }).catch(() => toast('error', 'DM failed'));
        }}>＋</button>
      </div>
      {dms.map((d) => (
        <button key={d.id} className={cx('dm-row', activeDMId === d.id && 'active')}
          onClick={() => set({ activeDMId: d.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            openContext(e.clientX, e.clientY, [
              { label: 'Open', action: () => set({ activeDMId: d.id }) },
              { label: 'Copy DM id', action: () => { void navigator.clipboard?.writeText(d.id); } },
            ]);
          }}>
          <Avatar name={nameOf(d.id)} size={30} />
          <span className="dm-name">{nameOf(d.id)}</span>
          {(read[d.id]?.unread ?? 0) > 0 && <span className="mention-badge">{read[d.id].unread}</span>}
        </button>
      ))}
      {dms.length === 0 && <p className="muted small">No DMs yet.</p>}
      <button className="btn ghost sm" onClick={() => {
        const name = prompt('Group name:');
        if (!name) return;
        const who = prompt('Usernames, comma separated:');
        if (!who) return;
        api.users().then((r) => {
          const ids = who.split(',').map((s) => s.trim().toLowerCase())
            .map((n) => r.users.find((u) => u.username.toLowerCase() === n)?.id).filter(Boolean) as string[];
          if (ids.length === 0) { toast('error', 'No matching users'); return null; }
          return api.createDM(ids, name).then(({ dm }) => refresh().then(() => set({ activeDMId: dm.id })));
        }).then((v) => { if (v !== null) toast('success', 'Group created'); }).catch(() => toast('error', 'Group failed'));
      }}>+ New group DM</button>
    </div>
  );
}

function DMChat({ dmId }: { dmId: string }) {
  const dms = useData((s) => s.dms);
  const users = useData((s) => s.users);
  const me = useAuth((s) => s.user);
  const d = dms.find((x) => x.id === dmId);
  useEffect(() => {
    if (!dmId) return;
    useData.getState().loadMessages(dmId)
      .then(() => {
        // entering a DM clears its unread badge
        const msgs = useData.getState().messages[dmId] ?? [];
        const last = msgs[msgs.length - 1];
        if (last) useData.getState().markRead(dmId, last.id);
      })
      .catch(() => undefined);
  }, [dmId]);
  if (!d) return <EmptyState icon="✉" title="DM not found" />;
  const ids = (Array.isArray(d.memberIds) ? d.memberIds : JSON.parse(String(d.memberIds)) as string[]).filter((i) => i !== me?.id);
  const title = d.isGroup ? d.name : users[ids[0]]?.displayName ?? d.name;
  return (
    <div className="dm-chat">
      <header className="ch-header"><span className="ch-icon">@</span><b>{title}</b></header>
      <MessageList channelId={dmId} />
      <Composer channelId={dmId} placeholder={`Message ${title}`} />
    </div>
  );
}
