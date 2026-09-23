# Changelog

All notable changes to Orbit are documented here.

## [0.3.10] — 2026-09-23 — Restart Fix
### Fixed
- “Restart now” in the *Updating Orbit* popup now correctly closes the popup — use the main window’s banner *Restart now* (which always worked) to restart. The popup was trying to call a blocked API.

## [0.3.9] — 2026-09-23 — Silent 1-min Updater + Per-Device Installs
### Changed
- Updater now checks **every 1 minute** (was 30) and is **silent** on “Checking…” — only pops the “Updating Orbit” window when an update is actually found/downloading/ready.
- Installs are now **per-device** (deviceId), not per-user — so both your PCs show as separate rows, and your friend’s PC shows separately too.

### Fixed
- Second PC now appears in Installs — previously same user on two PCs overwrote one row.

## [0.3.8] — 2026-09-23 — Ping + Visible Updater
### Added
- **Updating Orbit window** — a centered, always-on-top mini-window that appears the moment an update is found, shows live progress (“Checking…”, “Downloading v0.3.8 — 42%”, “Ready — Restart now”), and auto-closes after install.
- **Changelog popup** — after every update, the first launch shows “What’s new in v0.3.8” (this file) so users see what changed.

### Fixed
- Second-PC auto-update: old installs (0.3.4) now fall back from `orbit-chat` → `orbitOWNER` so they find new releases.

### Changed
- Updater checks every 30 min + on window focus (was 60 min only).

## [0.3.7] — 2026-09-23 — Owner Installs
- Owner-only **Installs 👑** tab (only `sansOWNER` sees it) — lists every device that has reported.
- App reports `appVersion/platform/arch` on launch.
- Robust updater fallback + better banners.

## [0.3.6] — Every Device Update
- `orbitOWNER/orbit` feed, differential updates.

## [0.3.5] — Friends Fix
- Case-insensitive add, reciprocal auto-accept, proper errors, DM dedupe.

## [0.3.4] — Installs
- Per-device data dir, silent feed test.

## [0.3.3] — Reliability
- Persistent read state + offline queue (clientId dedupe).

## [0.3.2] — Auth Persistence
- Encrypted session survives reinstalls.
