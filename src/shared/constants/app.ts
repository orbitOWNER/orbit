export const APP_NAME = 'Orbit';
export const API_PORT = 6742;
export const INVITE_PREFIX = 'orbit.gg/';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_UPLOAD_MB = 25;
export const ALLOWED_UPLOAD_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/plain', 'application/pdf', 'audio/mpeg', 'audio/ogg',
  'video/mp4', 'video/webm', 'application/zip',
]);
export const BLOCKED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'msi', 'ps1', 'vbs', 'jar', 'scr', 'com', 'dll']);
export const EMOJI_SET = ['👍','❤️','😂','🎉','🚀','👀','🔥','💯','🪐','✨','😮','😢','🙏','👋','🎮'];
export const PERMISSIONS_ALL = [
  'administrator','manageServer','manageChannels','manageRoles','kickMembers',
  'banMembers','manageMessages','mentionEveryone','connect','speak','stream',
] as const;
export const SHORTCUTS: Record<string, string> = {
  quickSwitcher: 'Ctrl/Cmd+K',
  search: 'Ctrl/Cmd+Shift+F',
  settings: 'Ctrl/Cmd+,',
  mute: 'Ctrl/Cmd+Shift+M',
  deafen: 'Ctrl/Cmd+Shift+D',
};
