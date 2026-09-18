# Orbit 🪐

Original community-chat desktop app: **Electron + React + TypeScript + Vite**, local **SQLite** (via `sql.js`, file-persisted), **REST + WebSocket** backend in Node/TS, **Zustand** state. Familiar Discord-style structure with 100% original branding, colors, and assets (emoji + CSS only — no copied logos or artwork).

## What was implemented

- **Servers bar**: home, switch, add, explore/join-by-invite, active pill, unread badges, right-click menu (mark read, settings, leave).
- **Channels**: text/announcement/voice/category, # general/# announcements/# gaming/# random seeded, create/edit/delete, drag-reorder, collapsible groups, context menus, unread dots, mention badges, per-channel mute.
- **Chat**: grouped messages, avatars, role colors, timestamps, hover toolbar (react/reply/pin/copy/edit/delete), context menu, reply, edit, delete, pin, report, markdown + code highlighting, clickable links (open externally), attachments (drag-drop, paste images, progress, validation), **offline outbox** (queued ⏳/failed ⚠ states with retry, exponential backoff, idempotent sends), empty/loading/error+retry states, windowed list + "load earlier" pagination.
- **Composer**: send button, emoji picker, GIF-by-link attach, file button, @user/#channel autocomplete, Enter/Shift+Enter, typing events, char counter, ↑-to-edit-last.
- **Members**: online/offline sections, presence dots, role colors, profile popover (avatar, status, roles, joined date, DM, block).
- **DMs/Home**: friends list, requests (send/accept/decline), search, block/remove, 1:1 + group DMs, DM history.
- **Voice**: join/leave, mute/deafen, speaking indicator (mic analyser), peer list in channel, connection bar, push-to-talk setting, device selection, WebRTC signaling interface (`VOICE_SIGNAL` relay over WS + `RTC_CONFIG` STUN in one place).
- **Video/share**: camera on/off (`getUserMedia`), screen share (`getDisplayMedia`), video grid, mute/deafen controls; remote tiles honestly labeled (full mesh needs TURN — see below).
- **Search**: global messages/users/channels, jump-to-message highlight, recent searches, `Ctrl+Shift+F`.
- **Notifications**: unread counts, mention badges, desktop notifications (Electron + Web fallback), per-channel/server mute, DND.
- **Reliability**: unread markers persisted in SQLite (survive restarts), offline message queue persisted across restarts, idempotent sends (retries never double-post, even past the anti-spam filter).
- **User settings** (10 tabs): account (display name, username, email, avatar upload, password change, delete account), profile (status, bio), appearance (dark/light, accent, cozy/compact, font scale), accessibility (reduce motion, focus states, ARIA), notifications, voice&video, keybinds, privacy, security, language.
- **Server settings**: overview, roles (create + permissions), channels, members (roles, timeout, kick, ban), invites info, moderation notes, audit log — all permission-gated.
- **Moderation**: kick/ban/timeout/delete/report/audit + server-side rate-limit + duplicate anti-spam.
- **Invites**: expiring/max-use codes, `orbit://code` deep links (Electron + in-app join), invalid/expired screens.
- **Presence**: online/idle/dnd/invisible/offline + custom status.
- **Shortcuts**: `Ctrl/⌘+K` switcher, `Ctrl/⌘+⇧+F` search, `Ctrl/⌘+,` settings, `Esc`, `↑`-edit, `Ctrl/⌘+⇧+M/D` mute/deafen (+ global M/D in desktop).
- **Quick switcher**: channels/servers/DMs/users, keyboard nav.
- **Data**: all entities from the spec; SQLite schema + seed (demo user `nova@orbit.local`, 2 servers, channels, members, messages, reactions, roles, DM, invites).
- **Realtime**: all 13 event types over WS with auto-reconnect; clean `Database`/`API`/`VoiceEngine` seams for a Postgres swap.
- **Security**: bcrypt passwords, JWT, zod validation, DOMPurify + `marked`, upload MIME/extension/size checks, `contextIsolation` + `sandbox` + no nodeIntegration, restrictive CSP.
- **Desktop**: tray + minimize-to-tray, notifications, deep links, native file picker (attach input + `orbit:pickFiles`), clipboard, global shortcuts.
- **Tests**: vitest suites for auth crypto, validation, spam/events/policy, UI primitives.

## Run it

```powershell
Set-Location D:\ELBER\orbit
Copy-Item .env.example .env
npm install
npm run db:migrate   # migrate + seed SQLite at ./data/orbit.sqlite
npm run server       # API+WS on http://127.0.0.1:6742 (leave running)
npm run dev          # web build of the app on http://localhost:5174 (proxies /api + /ws)
```

Desktop (Electron):

```powershell
npm run build:all    # renderer + main into dist/
npm start            # Electron window (spawns embedded backend automatically)
```

Log in with the seeded demo account: `nova@orbit.local` / `orbit-demo-123`, or register a new user.

## Build installers

```powershell
npm run dist:win     # Windows NSIS (.exe)
npm run dist:mac     # macOS dmg (run on macOS)
npm run dist:linux   # Linux AppImage
```

Output lands in `release/`.

## Automatic updates (every device)

Orbit ships with **electron-updater** wired for silent background updates:

- On startup and every hour, each installed app checks its release feed.
- New versions **download automatically** in the background (differential
  blockmap deltas when possible, full installer otherwise).
- A banner appears (`UpdateBanner`) with download progress and a
  **Restart now** button; otherwise the update installs on the next quit
  (`autoInstallOnAppQuit`). No user action or reinstall is ever required.
- A manual **Check for updates** button + current version live in
  Settings → Security. All update failures degrade silently (logged to the
  main-process debug log, never a crash, never a popup).
- Startup is never blocked by the updater: the module loads lazily behind
  a 15s timeout (`getUpdater()` in `src/main/main.ts`).

Release workflow (maintainer):

1. Bump `version` in `package.json`.
2. `npm run dist:win` (and mac/linux as needed) — this also emits
   `latest.yml` + blockmaps into `release/`.
3. Create a GitHub release in `orbit-chat/orbit` and upload the `release/`
   artifacts (`Orbit Setup *.exe`, `latest.yml`, `.blockmap` files).
4. Every installed device picks it up within an hour (or on next launch).

`electron-builder.yml` `publish:` already points at that repo. For a
self-hosted feed instead, point `publish` at a `generic` URL — or set the
`ORBIT_UPDATE_URL` env var on a device to override the feed at runtime.

## Tests / lint

```powershell
npm test             # vitest run
npm run lint         # tsc --noEmit
```

## What remains intentionally incomplete

- **Remote voice mesh**: mic pipeline, speaking detection, mute/deafen, and SDP/ICE relay (`VOICE_SIGNAL`) are real; true multi-machine audio needs a TURN server + prod signaling — plug credentials into `RTC_CONFIG` (`src/renderer/stores/useVoice.ts`) and the `server/websocket/hub.ts` relay.
- **Postgres swap**: `server/database/db.ts` is the single seam — implement the same `all/get/run` helpers against `pg` and set `DATABASE_URL`; REST/WS shapes stay identical.
- **File bytes**: attachments persist as data-URLs inside SQLite in v1 (works offline, capped at 25 MB); a future `UPLOAD_DIR` object store can replace the column without UI changes.

## Important files

- `src/shared/types/models.ts`, `src/shared/events/events.ts`, `src/shared/constants/app.ts`
- `server/index.ts`, `server/api/routes.ts`, `server/websocket/hub.ts`
- `server/database/db.ts`, `server/database/schema.ts`, `server/database/seed.ts`, `server/services/{auth,permissions,spam}.ts`
- `src/main/main.ts`, `src/preload/preload.ts`
- `src/renderer/{App,main}.tsx`, `stores/{useAuth,useData,useUI,useSettings,useVoice}.ts`
- `src/renderer/lib/{api,realtime,markdown,utils,desktop}.ts`
- `src/renderer/components/{ui,chat,sidebar,modals,settings}.tsx`, `features/{auth/Auth,friends/home}.tsx`
- `tests/*.test.{ts,tsx}`, `.env.example`, `electron-builder.yml`
