export const OrbitEvents = {
  MESSAGE_CREATE: 'MESSAGE_CREATE',
  MESSAGE_UPDATE: 'MESSAGE_UPDATE',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  REACTION_ADD: 'REACTION_ADD',
  REACTION_REMOVE: 'REACTION_REMOVE',
  TYPING_START: 'TYPING_START',
  PRESENCE_UPDATE: 'PRESENCE_UPDATE',
  MEMBER_JOIN: 'MEMBER_JOIN',
  MEMBER_LEAVE: 'MEMBER_LEAVE',
  CHANNEL_CREATE: 'CHANNEL_CREATE',
  CHANNEL_UPDATE: 'CHANNEL_UPDATE',
  CHANNEL_DELETE: 'CHANNEL_DELETE',
  VOICE_STATE_UPDATE: 'VOICE_STATE_UPDATE',
  SERVER_CREATE: 'SERVER_CREATE',
  SERVER_UPDATE: 'SERVER_UPDATE',
  SERVER_DELETE: 'SERVER_DELETE',
  FRIEND_UPDATE: 'FRIEND_UPDATE',
  NOTIFY: 'NOTIFY',
} as const;

export type OrbitEventName = (typeof OrbitEvents)[keyof typeof OrbitEvents];

export interface OrbitEvent<T = unknown> {
  type: OrbitEventName;
  data: T;
  at: string;
}

export function orbitEvent<T>(type: OrbitEventName, data: T): OrbitEvent<T> {
  return { type, data, at: new Date().toISOString() };
}
