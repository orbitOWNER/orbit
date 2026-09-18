import React, { useEffect, useState } from 'react';
import { PERMISSIONS_ALL } from '@shared/constants/app';
import { api } from '../lib/api';
import { useAuth } from '../stores/useAuth';
import { useData } from '../stores/useData';
import { useSettings } from '../stores/useSettings';
import { useUI } from '../stores/useUI';
import { useUpdates } from '../stores/useUpdates';
import { Avatar, Field, Modal, Toggle } from './ui';

const USER_TABS = ['My Account', 'Profile', 'Appearance', 'Accessibility', 'Notifications', 'Voice & Video', 'Keybinds', 'Privacy', 'Security', 'Language'] as const;

export function SettingsModal() {
  const close = useUI((s) => s.closeModal);
  const me = useAuth((s) => s.user);
  const patchMe = useAuth((s) => s.patchMe);
  const logout = useAuth((s) => s.logout);
  const toast = useUI((s) => s.toast);
  const st = useSettings();
  const [tab, setTab] = useState<(typeof USER_TABS)[number]>('My Account');
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [customStatus, setCustomStatus] = useState(me?.customStatus ?? '');
  const [status, setStatus] = useState(me?.status ?? 'online');
  const [avatar, setAvatar] = useState(me?.avatar ?? '🪐');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctError, setAcctError] = useState<string | null>(null);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const AVATARS = ['🪐', '🚀', '🎮', '🎧', '🌙', '⚡', '🎨', '📚'];

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput' || x.kind === 'audiooutput'))).catch(() => setDevices([]));
  }, []);

  const saveProfile = () => {
    patchMe({ displayName: displayName.trim() || me!.displayName, customStatus: customStatus || null, status, avatar })
      .then(() => toast('success', 'Profile saved')).catch(() => toast('error', 'Save failed'));
  };

  const saveAccount = () => {
    if (!me) return;
    setAcctBusy(true); setAcctError(null);
    patchMe({
      displayName: displayName.trim() || me.displayName,
      username: username.trim() || me.username,
      email: email.trim() || me.email,
      bio: bio.trim() || null,
      avatar,
    })
      .then(() => toast('success', 'Account saved'))
      .catch((e: Error) => setAcctError(e.message))
      .finally(() => setAcctBusy(false));
  };

  const onAvatarFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setAcctError('Please choose an image file'); return; }
    if (f.size > 500 * 1024) { setAcctError('Image must be under 500 KB'); return; }
    const r = new FileReader();
    r.onload = () => { setAvatar(String(r.result)); setAcctError(null); };
    r.onerror = () => setAcctError("Couldn't read that image");
    r.readAsDataURL(f);
  };

  const changePassword = () => {
    setPwMsg(null);
    if (newPw !== newPw2) { setPwMsg('New passwords do not match'); return; }
    setPwBusy(true);
    api.updatePassword({ currentPassword: curPw, newPassword: newPw })
      .then(() => { setCurPw(''); setNewPw(''); setNewPw2(''); setPwMsg('Password changed'); toast('success', 'Password changed'); })
      .catch((e: Error) => setPwMsg(e.message))
      .finally(() => setPwBusy(false));
  };

  const deleteAccount = () => {
    if (!delPw) return;
    setDelBusy(true);
    api.deleteAccount(delPw)
      .then(() => { logout(); close(); toast('success', 'Account deleted'); })
      .catch((e: Error) => { setPwMsg(e.message); toast('error', e.message); })
      .finally(() => setDelBusy(false));
  };

  return (
    <Modal title="User settings" onClose={close} wide>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {USER_TABS.map((t) => <button key={t} className={tab === t ? 'sel' : ''} onClick={() => setTab(t)}>{t}</button>)}
          <button className="danger" onClick={() => { logout(); close(); }}>Log out</button>
        </nav>
        <div className="settings-pane">
          {tab === 'My Account' && me && (
            <>
              <div className="profile-card">
                <Avatar name={me.displayName} icon={me.avatar} size={64} />
                <div><h3>{me.displayName}</h3><p className="muted">@{me.username} • {me.email}</p></div>
              </div>
              {acctError && <div className="form-error" role="alert">{acctError}</div>}
              <Field label="Display name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} /></Field>
              <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} placeholder="nova" /></Field>
              <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></Field>
              <Field label="About me"><textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={512} rows={3} placeholder="A few words about you…" /></Field>
              <Field label="Avatar">
                <div className="icon-pick">{AVATARS.map((a) => <button key={a} className={avatar === a ? 'sel' : ''} onClick={() => setAvatar(a)}>{a}</button>)}</div>
                <div className="row" style={{ border: 'none', paddingTop: 8 }}>
                  <span className="muted small">…or upload an image (≤500 KB)</span>
                  <label className="btn sm" style={{ cursor: 'pointer' }}>Upload
                    <input type="file" hidden accept="image/*" onChange={(e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </div>
              </Field>
              <button className="btn primary sm" disabled={acctBusy} onClick={saveAccount}>{acctBusy ? 'Saving…' : 'Save changes'}</button>

              <h4 style={{ marginTop: 20 }}>Password</h4>
              {pwMsg && <div className={pwMsg === 'Password changed' ? 'toast success' : 'form-error'} role="status">{pwMsg}</div>}
              <Field label="Current password"><input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" /></Field>
              <Field label="New password (min 8 characters)"><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Confirm new password"><input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" /></Field>
              <button className="btn sm" disabled={pwBusy || !curPw || !newPw} onClick={changePassword}>{pwBusy ? 'Changing…' : 'Change password'}</button>

              <h4 style={{ marginTop: 20 }}>Danger zone</h4>
              {!showDelete
                ? <button className="btn sm danger-text" onClick={() => setShowDelete(true)}>Delete my account…</button>
                : (
                  <>
                    <p className="muted small">This permanently deletes your profile, messages, memberships and friendships. Servers you own must be deleted first. This cannot be undone.</p>
                    <Field label="Confirm with your password"><input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" /></Field>
                    <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                      <button className="btn sm" onClick={() => { setShowDelete(false); setDelPw(''); }}>Cancel</button>
                      <button className="btn danger sm" disabled={delBusy || !delPw} onClick={deleteAccount}>{delBusy ? 'Deleting…' : 'Delete forever'}</button>
                    </div>
                  </>
                )}
            </>
          )}
          {tab === 'Profile' && (
            <>
              <Field label="Custom status"><input value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} maxLength={128} placeholder="What are you up to?" /></Field>
              <Field label="Presence">
                <select value={status} onChange={(e) => { setStatus(e.target.value); void api.presence(e.target.value).catch(() => toast('error', 'Presence failed')); }}>
                  <option value="online">Online</option><option value="idle">Idle</option>
                  <option value="dnd">Do Not Disturb</option><option value="invisible">Invisible</option><option value="offline">Offline</option>
                </select>
              </Field>
              <button className="btn primary sm" onClick={saveProfile}>Save changes</button>
            </>
          )}
          {tab === 'Appearance' && (
            <>
              <Field label="Theme">
                <select value={st.theme} onChange={(e) => st.set({ theme: e.target.value as 'dark' | 'light' })}>
                  <option value="dark">Dark charcoal</option><option value="light">Light</option>
                </select>
              </Field>
              <Field label="Accent color"><input type="color" value={st.accent} onChange={(e) => st.set({ accent: e.target.value })} aria-label="Accent color" /></Field>
              <Field label="Message density">
                <select value={st.density} onChange={(e) => st.set({ density: e.target.value as 'cozy' | 'compact' })}>
                  <option value="cozy">Cozy</option><option value="compact">Compact</option>
                </select>
              </Field>
              <Field label={`Font scale (${Math.round(st.fontScale * 100)}%)`}>
                <input type="range" min={0.85} max={1.3} step={0.05} value={st.fontScale} onChange={(e) => st.set({ fontScale: parseFloat(e.target.value) })} aria-label="Font scale" />
              </Field>
            </>
          )}
          {tab === 'Accessibility' && (
            <>
              <div className="row"><span>Reduce motion</span><Toggle checked={st.reduceMotion} onChange={(v) => st.set({ reduceMotion: v })} label="Reduce motion" /></div>
              <p className="muted small">Focus rings are always visible; all controls are keyboard reachable with ARIA labels.</p>
            </>
          )}
          {tab === 'Notifications' && (
            <>
              <div className="row"><span>Desktop notifications</span><Toggle checked={st.desktopNotifications} onChange={(v) => st.set({ desktopNotifications: v })} label="Desktop notifications" /></div>
              <div className="row"><span>Do Not Disturb (mute all)</span><Toggle checked={st.dnd} onChange={(v) => st.set({ dnd: v })} label="Do not disturb" /></div>
            </>
          )}
          {tab === 'Voice & Video' && (
            <>
              <Field label="Microphone">
                <select value={st.inputDevice} onChange={(e) => st.set({ inputDevice: e.target.value })}>
                  <option value="default">Default</option>
                  {devices.filter((d) => d.kind === 'audioinput').map((d, i) => <option key={i} value={d.deviceId}>{d.label || `Mic ${i + 1}`}</option>)}
                </select>
              </Field>
              <Field label="Output">
                <select value={st.outputDevice} onChange={(e) => st.set({ outputDevice: e.target.value })}>
                  <option value="default">Default</option>
                  {devices.filter((d) => d.kind === 'audiooutput').map((d, i) => <option key={i} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>)}
                </select>
              </Field>
              <div className="row"><span>Push-to-talk</span><Toggle checked={st.pushToTalk} onChange={(v) => st.set({ pushToTalk: v })} label="Push to talk" /></div>
              {st.pushToTalk && <Field label="Push-to-talk key"><input value={st.pttKey} onChange={(e) => st.set({ pttKey: e.target.value.toUpperCase().slice(0, 1) })} maxLength={1} /></Field>}
            </>
          )}
          {tab === 'Keybinds' && (
            <ul className="keybinds">
              <li><kbd>Ctrl/⌘ K</kbd> Quick switcher</li>
              <li><kbd>Ctrl/⌘ ⇧ F</kbd> Search</li>
              <li><kbd>Ctrl/⌘ ,</kbd> Settings</li>
              <li><kbd>Esc</kbd> Close modal</li>
              <li><kbd>↑</kbd> (empty box) Edit last message</li>
              <li><kbd>Ctrl/⌘ ⇧ M</kbd> Mute</li>
              <li><kbd>Ctrl/⌘ ⇧ D</kbd> Deafen</li>
            </ul>
          )}
          {tab === 'Privacy' && <p className="muted">Friend requests require your username. Blocked users cannot DM you. Read receipts are local-only in this build.</p>}
          {tab === 'Security' && (
            <>
              <p className="muted">Passwords are hashed with bcrypt and never stored in plaintext. Tokens are JWTs kept in local storage.</p>
              <button className="btn sm" onClick={() => { logout(); close(); }}>Sign out everywhere (this device)</button>
              <UpdateSection />
            </>
          )}
          {tab === 'Language' && (
            <Field label="Language">
              <select value={st.language} onChange={(e) => st.set({ language: e.target.value })}>
                <option value="en">English</option><option value="es">Español</option><option value="de">Deutsch</option>
              </select>
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Server settings ----------
const SERVER_TABS = ['Overview', 'Roles', 'Channels', 'Members', 'Invites', 'Moderation', 'Audit log'] as const;

function UpdateSection() {
  const status = useUpdates((s) => s.status);
  const info = useUpdates((s) => s.info);
  const progress = useUpdates((s) => s.progress);
  const checkForUpdates = useUpdates((s) => s.checkForUpdates);
  const quitAndInstall = useUpdates((s) => s.quitAndInstall);
  const [version, setVersion] = useState<string>('');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    import('../lib/desktop').then(({ desktop }) => desktop.getAppVersion().then(setVersion).catch(() => setVersion('')));
  }, []);
  return (
    <div style={{ marginTop: 16 }}>
      <h4>App updates</h4>
      <p className="muted small">Version {version || '…'} — Orbit checks for updates automatically and installs them on restart.</p>
      <div className="row">
        <span>{status === 'downloaded' ? `v${info?.version} ready` : status === 'downloading' ? `Downloading… ${progress ?? 0}%` : status === 'checking' || checking ? 'Checking…' : 'Up to date check'}</span>
        <span className="row-actions">
          {status === 'downloaded'
            ? <button className="btn primary sm" onClick={() => void quitAndInstall()}>Restart & install</button>
            : <button className="btn sm" disabled={checking || status === 'checking'} onClick={() => { setChecking(true); void checkForUpdates().finally(() => setChecking(false)); }}>Check for updates</button>}
        </span>
      </div>
    </div>
  );
}

function useCan(perm: string): boolean {
  const activeServerId = useUI((s) => s.activeServerId);
  const me = useAuth((s) => s.user);
  const members = useData((s) => s.members);
  const roles = useData((s) => s.roles);
  const servers = useData((s) => s.servers);
  if (!activeServerId || !me) return false;
  if (servers.find((s) => s.id === activeServerId)?.ownerId === me.id) return true;
  const m = members.find((x) => x.serverId === activeServerId && x.userId === me.id);
  const rids = (Array.isArray(m?.roleIds) ? m.roleIds : []) as string[];
  const perms = new Set(roles.filter((r) => rids.includes(r.id)).flatMap((r) => r.permissions));
  return perms.has('administrator') || perms.has(perm);
}

export function ServerSettingsModal() {
  const close = useUI((s) => s.closeModal);
  const toast = useUI((s) => s.toast);
  const activeServerId = useUI((s) => s.activeServerId);
  const servers = useData((s) => s.servers);
  const upsertServer = useData((s) => s.upsertServer);
  const channels = useData((s) => s.channels);
  const members = useData((s) => s.members);
  const roles = useData((s) => s.roles);
  const users = useData((s) => s.users);
  const refreshMembers = useData((s) => s.refreshMembers);
  const refreshRoles = useData((s) => s.refreshRoles);
  const [tab, setTab] = useState<(typeof SERVER_TABS)[number]>('Overview');
  const server = servers.find((s) => s.id === activeServerId);
  const [name, setName] = useState(server?.name ?? '');
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#7cc7ff');
  const [rolePerms, setRolePerms] = useState<string[]>(['connect', 'speak']);
  const [audit, setAudit] = useState<{ id: string; action: string; actorId: string; targetId: string | null; detail: string | null; createdAt: string }[]>([]);
  const canManage = useCan('manageServer');
  const canRoles = useCan('manageRoles');
  const canChannels = useCan('manageChannels');
  const canMod = useCan('kickMembers');

  useEffect(() => {
    if (activeServerId) {
      refreshMembers(activeServerId).catch(() => undefined);
      refreshRoles(activeServerId).catch(() => undefined);
      if (tab === 'Audit log') api.audit(activeServerId).then((r) => setAudit(r.entries)).catch(() => setAudit([]));
    }
  }, [activeServerId, tab, refreshMembers, refreshRoles]);

  if (!server) return null;
  const serverMembers = members.filter((m) => m.serverId === server.id);

  return (
    <Modal title={`${server.name} — settings`} onClose={close} wide>
      <div className="settings">
        <nav className="settings-nav" aria-label="Server settings">
          {SERVER_TABS.map((t) => <button key={t} className={tab === t ? 'sel' : ''} onClick={() => setTab(t)}>{t}</button>)}
        </nav>
        <div className="settings-pane">
          {tab === 'Overview' && (
            <>
              <Field label="Server name"><input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} maxLength={100} /></Field>
              <button className="btn primary sm" disabled={!canManage} onClick={() => {
                api.patchServer(server.id, { name }).then(({ server: s }) => { upsertServer(s); toast('success', 'Server updated'); }).catch(() => toast('error', 'Needs Manage Server'));
              }}>Save</button>
              {!canManage && <p className="muted small">You need Manage Server to edit.</p>}
            </>
          )}
          {tab === 'Roles' && (
            <>
              {roles.filter((r) => r.serverId === server.id).map((r) => (
                <div key={r.id} className="row"><span className="role-chip" style={{ borderColor: r.color, color: r.color }}>{r.name}</span><small className="muted">{r.permissions.join(', ') || 'no permissions'}</small></div>
              ))}
              {canRoles ? (
                <>
                  <Field label="New role name"><input value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={50} /></Field>
                  <Field label="Color"><input type="color" value={roleColor} onChange={(e) => setRoleColor(e.target.value)} aria-label="Role color" /></Field>
                  <div className="perm-grid">
                    {PERMISSIONS_ALL.map((p) => (
                      <label key={p} className="perm"><input type="checkbox" checked={rolePerms.includes(p)} onChange={() => setRolePerms((x) => x.includes(p) ? x.filter((y) => y !== p) : [...x, p])} /> {p}</label>
                    ))}
                  </div>
                  <button className="btn primary sm" disabled={!roleName.trim()} onClick={() => {
                    api.createRole(server.id, { name: roleName.trim(), color: roleColor, permissions: rolePerms })
                      .then(() => { setRoleName(''); return refreshRoles(server.id); }).then(() => toast('success', 'Role created')).catch(() => toast('error', 'Create failed'));
                  }}>Create role</button>
                </>
              ) : <p className="muted small">You need Manage Roles.</p>}
            </>
          )}
          {tab === 'Channels' && (
            <>
              {channels.filter((c) => c.serverId === server.id).map((c) => <div key={c.id} className="row"><span># {c.name} <small className="muted">({c.type})</small></span></div>)}
              {!canChannels && <p className="muted small">You need Manage Channels.</p>}
            </>
          )}
          {tab === 'Members' && (
            <>
              {serverMembers.map((m) => {
                const u = users[m.userId];
                const rids = (Array.isArray(m.roleIds) ? m.roleIds : []) as string[];
                return (
                  <div key={m.id} className="row">
                    <span><Avatar name={u?.displayName ?? '?'} icon={u?.avatar} size={24} /> {m.nickname ?? u?.displayName} <small className="muted">@{u?.username}</small></span>
                    <span className="row-actions">
                      {canRoles && (
                        <select aria-label={`Roles for ${u?.username}`} value={rids[0] ?? ''} onChange={(e) => {
                          void api.setRoles(server.id, m.userId, e.target.value ? [e.target.value] : []).then(() => refreshMembers(server.id)).catch(() => toast('error', 'Role update failed'));
                        }}>
                          <option value="">Member</option>
                          {roles.filter((r) => r.serverId === server.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}
                      {canMod && (
                        <>
                          <button className="btn ghost sm" onClick={() => { void api.timeout(server.id, m.userId, 10).then(() => toast('success', 'Timed out 10m')).catch(() => toast('error', 'Timeout failed')); }}>Timeout</button>
                          <button className="btn ghost sm" onClick={() => { void api.kick(server.id, m.userId).then(() => refreshMembers(server.id)).catch(() => toast('error', 'Kick failed')); }}>Kick</button>
                          <button className="btn ghost sm danger-text" onClick={() => { void api.ban(server.id, m.userId).then(() => refreshMembers(server.id)).catch(() => toast('error', 'Ban failed')); }}>Ban</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </>
          )}
          {tab === 'Invites' && <p className="muted">Create fresh invites from the channel sidebar (Invite people). Codes look like <code>orbit://xxxx-xxxx</code>.</p>}
          {tab === 'Moderation' && (
            <p className="muted">Kick, ban, and 10-minute timeouts live under Members. Message authors (or members with Manage Messages) can edit/delete; deletions by moderators are written to the audit log. Rate-limit + duplicate anti-spam runs on the server.</p>
          )}
          {tab === 'Audit log' && (
            <>
              {audit.length === 0 && <p className="muted">No entries yet.</p>}
              {audit.map((a) => (
                <div key={a.id} className="row"><span><b>{a.action}</b> <small className="muted">by {users[a.actorId]?.username ?? a.actorId.slice(0, 6)} → {a.targetId?.slice(0, 8) ?? '—'} {a.detail ?? ''}</small></span><small className="muted">{new Date(a.createdAt).toLocaleString()}</small></div>
              ))}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
