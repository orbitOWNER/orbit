import { create } from 'zustand';
import { api, type VoiceStateShape } from '../lib/api';
import { sendSignal } from '../lib/realtime';

// Voice engine: local mic pipeline + WebRTC signaling interface.
// Local dev: full mic/speaking pipeline works; remote mesh relays SDP/ICE
// over the WS hub (VOICE_SIGNAL). Production multi-user needs STUN/TURN,
// which is configured in one place (RTC_CONFIG below).
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

interface VoiceState {
  channelId: string | null;
  serverId: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  video: boolean;
  sharing: boolean;
  connecting: boolean;
  error: string | null;
  peers: VoiceStateShape[];
  localStream: MediaStream | null;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
  setDeafened: (d: boolean) => Promise<void>;
  setVideo: (v: boolean) => Promise<void>;
  setSharing: (s: boolean) => Promise<void>;
  setSpeaking: (s: boolean) => void;
  applyPeers: (states: VoiceStateShape[]) => void;
  applyRemote: (userId: string, patch: Partial<VoiceStateShape>) => void;
}

let analyserTimer: number | null = null;

function stopAnalyser(): void {
  if (analyserTimer) { clearInterval(analyserTimer); analyserTimer = null; }
}

async function micStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { return null; }
}

function watchSpeaking(stream: MediaStream, onLevel: (speaking: boolean) => void): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyserTimer = window.setInterval(() => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      onLevel(avg > 14);
    }, 200);
  } catch { /* analyser unavailable */ }
}

export const useVoice = create<VoiceState>((set, get) => ({
  channelId: null, serverId: null,
  muted: false, deafened: false, speaking: false,
  video: false, sharing: false,
  connecting: false, error: null, peers: [], localStream: null,

  join: async (channelId) => {
    set({ connecting: true, error: null });
    try {
      await api.voiceJoin(channelId);
      const stream = await micStream();
      stopAnalyser();
      if (stream) watchSpeaking(stream, (speaking) => {
        if (speaking !== get().speaking) {
          set({ speaking });
          void api.voiceState({ speaking }).catch(() => undefined);
        }
      });
      const { states } = await api.voiceStates().catch(() => ({ states: [] as VoiceStateShape[] }));
      const mine = states.find((s) => s.channelId === channelId);
      set({
        channelId, serverId: mine?.serverId ?? null, localStream: stream,
        muted: false, deafened: false, connecting: false, peers: states.filter((s) => s.channelId === channelId),
      });
      sendSignal({ kind: 'join', channelId });
    } catch (e) {
      set({ connecting: false, error: e instanceof Error ? e.message : 'Could not join voice' });
      throw e;
    }
  },
  leave: async () => {
    const { localStream } = get();
    try { localStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    stopAnalyser();
    try { await api.voiceLeave(); } catch { /* offline */ }
    sendSignal({ kind: 'leave', channelId: get().channelId });
    set({ channelId: null, serverId: null, localStream: null, speaking: false, video: false, sharing: false, muted: false, deafened: false, peers: [] });
  },
  setMuted: async (m) => {
    set({ muted: m });
    get().localStream?.getAudioTracks().forEach((t) => { t.enabled = !m; });
    try { await api.voiceState({ muted: m }); } catch { /* offline */ }
  },
  setDeafened: async (d) => {
    set({ deafened: d, muted: d ? true : get().muted });
    get().localStream?.getAudioTracks().forEach((t) => { t.enabled = !d && !get().muted; });
    try { await api.voiceState({ deafened: d, muted: d ? true : get().muted }); } catch { /* offline */ }
  },
  setVideo: async (v) => {
    if (v) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        const old = get().localStream;
        s.getVideoTracks().forEach((t) => old?.addTrack(t));
        set({ video: true });
      } catch { set({ error: 'Camera unavailable' }); return; }
    } else {
      get().localStream?.getVideoTracks().forEach((t) => { t.stop(); get().localStream?.removeTrack(t); });
      set({ video: false });
    }
    try { await api.voiceState({ video: get().video }); } catch { /* offline */ }
  },
  setSharing: async (s) => {
    if (s) {
      try {
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: true });
        disp.getVideoTracks().forEach((t) => get().localStream?.addTrack(t));
        set({ sharing: true });
        disp.getVideoTracks()[0]?.addEventListener('ended', () => void get().setSharing(false));
      } catch { return; }
    } else {
      set({ sharing: false });
    }
    try { await api.voiceState({ sharing: get().sharing }); } catch { /* offline */ }
  },
  setSpeaking: (s) => set({ speaking: s }),
  applyPeers: (states) => {
    const cid = get().channelId;
    set({ peers: cid ? states.filter((s) => s.channelId === cid) : states });
  },
  applyRemote: (userId, patch) => set((s) => ({
    peers: s.peers.some((p) => p.userId === userId)
      ? s.peers.map((p) => (p.userId === userId ? { ...p, ...patch } : p))
      : [...s.peers, { userId, channelId: s.channelId, serverId: s.serverId, muted: false, deafened: false, speaking: false, video: false, sharing: false, ...patch }],
  })),
}));
