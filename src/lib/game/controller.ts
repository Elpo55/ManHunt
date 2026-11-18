/**
 * Contrôleur de partie, indépendant de React.
 *
 *  - Resynchronisation complète (get_game_view) au chargement, à chaque
 *    (ré)abonnement Realtime, au retour au premier plan et quand un trou de
 *    séquence n'est pas comblé rapidement.
 *  - Application ordonnée des événements (séquenceur par flux).
 *  - Horloge serveur (aucune dépendance à l'horloge du téléphone).
 *  - Actions : appels RPC ; l'état n'est modifié qu'à partir des réponses
 *    et des événements serveur.
 */
import { AppError, toAppError } from "../errors";
import type { AbilityKey, Cell, GameEvent } from "../engine/types";
import { ServerClock } from "../realtime/clock";
import { StreamSequencer } from "../realtime/sequencer";
import { metrics } from "../metrics";
import { applyEvent, applyMoveResult, fromView, pruneExpired, streamsFor, type GameState, type GameView } from "./state";

/** Sous-ensemble de l'API utilisé (injectable pour les tests). */
export interface GameApi {
  gameView: (id: string) => Promise<GameView>;
  serverTime: () => Promise<number>;
  tick: (id: string) => Promise<unknown>;
  heartbeat: (id: string) => Promise<{ server_now: number }>;
  move: (id: string, path: [number, number][]) => Promise<{ x: number; y: number; steps: number; steps_at: number; server_now: number }>;
  capture: (id: string) => Promise<{ captured: string[]; cooldown_until: number; server_now: number }>;
  radar: (id: string) => Promise<{ at: number; uses: number }>;
  ability: (
    id: string,
    key: AbilityKey,
    target: Cell | null,
  ) => Promise<{ used_at: number; until: number | null; uses: number; result: Record<string, unknown> }>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  abort: (id: string) => Promise<void>;
  leaveGame: (id: string) => Promise<void>;
}

export interface ControllerSnapshot {
  state: GameState | null;
  error: AppError | null;
  pending: string | null;
}

type Listener = () => void;

export class GameController {
  readonly clock = new ServerClock();
  private seq = new StreamSequencer<GameEvent>();
  private snapshot: ControllerSnapshot = { state: null, error: null, pending: null };
  private listeners = new Set<Listener>();
  private loading = false;
  private reloadRequested = false;
  private buffer: GameEvent[] = [];
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  onEvent: ((ev: GameEvent, s: GameState) => void) | null = null;
  onError: ((e: AppError) => void) | null = null;

  setCallbacks(onEvent: GameController["onEvent"], onError: GameController["onError"]) {
    this.onEvent = onEvent;
    this.onError = onError;
  }

  constructor(
    readonly gameId: string,
    private api: GameApi,
  ) {}

  // ----- Abonnement (useSyncExternalStore) ----------------------------------
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;

  private set(patch: Partial<ControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  get state() {
    return this.snapshot.state;
  }

  dispose() {
    this.disposed = true;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.listeners.clear();
  }

  // ----- Synchronisation ------------------------------------------------------
  async syncClock(samples = 3) {
    for (let i = 0; i < samples; i++) {
      try {
        const t0 = Date.now();
        const server = await this.api.serverTime();
        this.clock.observe(t0, server, Date.now());
      } catch {
        return;
      }
    }
  }

  load = async (): Promise<void> => {
    if (this.disposed) return;
    if (this.loading) {
      this.reloadRequested = true;
      return;
    }
    this.loading = true;
    try {
      const t0 = Date.now();
      const view = await this.api.gameView(this.gameId);
      this.clock.observe(t0, view.server_now, Date.now());
      this.seq.reset(streamsFor(view));
      this.set({ state: fromView(view), error: null });
      metrics.resync();
    } catch (e) {
      this.set({ error: toAppError(e) });
    } finally {
      this.loading = false;
    }
    // Événements reçus pendant le chargement : le séquenceur écarte les doublons.
    const buffered = this.buffer;
    this.buffer = [];
    for (const ev of buffered) this.handleEvent(ev);
    if (this.reloadRequested) {
      this.reloadRequested = false;
      void this.load();
    }
  };

  scheduleResync = (delay = 300) => {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      void this.load();
    }, delay);
  };

  handleEvent = (ev: GameEvent) => {
    if (this.disposed) return;
    if (!this.snapshot.state || this.loading) {
      this.buffer.push(ev);
      return;
    }
    const r = this.seq.push(ev);
    if (r.kind === "apply") {
      this.deliver(r.events);
      if (!this.seq.hasPending() && this.gapTimer) {
        clearTimeout(this.gapTimer);
        this.gapTimer = null;
      }
    } else if (r.kind === "gap" && !this.gapTimer) {
      // Laisser une chance au message manquant d'arriver, puis resynchroniser.
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        if (this.seq.hasPending()) this.scheduleResync(0);
      }, 1500);
    }
  };

  private deliver(events: GameEvent[]) {
    let s = this.snapshot.state;
    if (!s) return;
    for (const ev of events) {
      s = applyEvent(s, ev);
      this.onEvent?.(ev, s);
    }
    if (s.needsResync) {
      s = { ...s, needsResync: false };
      this.scheduleResync(0);
    }
    this.set({ state: s });
  }

  /** Purge les informations expirées (radar, révélations, effets). */
  prune(now: number) {
    const s = this.snapshot.state;
    if (!s) return;
    const p = pruneExpired(s, now);
    if (p !== s) this.set({ state: p });
  }

  /** Prochaine échéance serveur connue (fin de phase, radar, fin d'effet). */
  nextDeadline(): number | null {
    const s = this.snapshot.state;
    if (!s || s.game.phase === "finished" || s.game.phase === "paused") return null;
    const n = this.clock.now();
    const c: number[] = [];
    if (s.game.phase_ends_at) c.push(s.game.phase_ends_at);
    if (s.game.next_radar_at) c.push(s.game.next_radar_at);
    for (const a of Object.values(s.allies)) if (a.ghost_until && a.ghost_until > n) c.push(a.ghost_until);
    for (const e of s.effects) c.push(e.expires_at);
    return c.length ? Math.min(...c) : null;
  }

  async tick() {
    try {
      await this.api.tick(this.gameId);
    } catch {
      /* le heartbeat prendra le relais */
    }
  }

  async heartbeat() {
    if (this.snapshot.state?.game.phase === "finished") return;
    try {
      const t0 = Date.now();
      const r = await this.api.heartbeat(this.gameId);
      this.clock.observe(t0, r.server_now, Date.now());
    } catch {
      /* réseau : la reconnexion est gérée par les canaux */
    }
  }

  // ----- Actions ----------------------------------------------------------------
  private async act<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    this.set({ pending: name });
    try {
      return await fn();
    } catch (e) {
      const err = toAppError(e);
      this.onError?.(err);
      if (["E_NOT_ENOUGH_STEPS", "E_INVALID_PATH", "E_NOT_ACTIVE", "E_PHASE", "E_CANNOT_MOVE_NOW"].includes(err.code)) {
        this.scheduleResync(0);
      }
      return null;
    } finally {
      this.set({ pending: null });
    }
  }

  move = async (path: Cell[]): Promise<boolean> => {
    if (!path.length) return false;
    const r = await this.act("move", () => this.api.move(this.gameId, path.map((c) => [c.x, c.y] as [number, number])));
    if (r && this.snapshot.state) this.set({ state: applyMoveResult(this.snapshot.state, r) });
    return !!r;
  };

  capture = async (): Promise<string[] | null> => {
    const r = await this.act("capture", () => this.api.capture(this.gameId));
    const s = this.snapshot.state;
    if (r && s) this.set({ state: { ...s, me: { ...s.me, last_capture_at: r.server_now } } });
    return r ? r.captured : null;
  };

  ability = async (key: AbilityKey, target: Cell | null): Promise<boolean> => {
    const r = await this.act(`ability:${key}`, () => this.api.ability(this.gameId, key, target));
    const s = this.snapshot.state;
    if (r && s) {
      const prev = s.cooldowns[key];
      let me = s.me;
      if (key === "sprint" && typeof r.result.steps === "number") me = { ...me, steps: r.result.steps, steps_at: r.used_at };
      this.set({
        state: {
          ...s,
          me,
          cooldowns: { ...s.cooldowns, [key]: { last_used_at: r.used_at, uses: r.uses, until: r.until ?? prev?.until ?? null } },
        },
      });
    }
    return !!r;
  };

  radar = async (): Promise<boolean> => {
    const r = await this.act("radar", () => this.api.radar(this.gameId));
    const s = this.snapshot.state;
    if (r && s) this.set({ state: { ...s, game: { ...s.game, radar_state: { radar_last: r.at, radar_uses: r.uses } } } });
    return !!r;
  };

  pause = async () => void (await this.act("pause", () => this.api.pause(this.gameId)));
  resume = async () => void (await this.act("resume", () => this.api.resume(this.gameId)));
  abort = async () => void (await this.act("abort", () => this.api.abort(this.gameId)));
  leave = async () => void (await this.act("leave", () => this.api.leaveGame(this.gameId)));
}
