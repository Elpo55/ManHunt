/**
 * Compteurs locaux de consommation (session courante) : aident à estimer
 * l'usage des quotas Supabase. Les totaux serveur sont dans get_usage_stats().
 */
type Listener = () => void;

const state = {
  rpcCalls: 0,
  rpcErrors: 0,
  realtimeReceived: 0,
  resyncs: 0,
  reconnects: 0,
  lastRttMs: null as number | null,
  startedAt: Date.now(),
  at: Date.now(),
};
let snapshot = { ...state };
const listeners = new Set<Listener>();

function emit() {
  state.at = Date.now();
  snapshot = { ...state };
  listeners.forEach((l) => l());
}

export const metrics = {
  rpc(ok: boolean, rtt: number) {
    state.rpcCalls++;
    if (!ok) state.rpcErrors++;
    state.lastRttMs = Math.round(rtt);
    emit();
  },
  received() {
    state.realtimeReceived++;
    emit();
  },
  resync() {
    state.resyncs++;
    emit();
  },
  reconnect() {
    state.reconnects++;
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get() {
    return snapshot;
  },
};
