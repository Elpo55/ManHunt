/**
 * Contrôleur de partie (indépendant de React et de la plateforme).
 *
 *  - Resynchronisation complète (get_game_view) au chargement, à chaque
 *    (ré)abonnement Realtime, au retour au premier plan, et sur trou de séquence.
 *  - Application ordonnée des événements (séquenceur par flux).
 *  - Horloge serveur : aucun chronomètre ne dépend de l'heure du téléphone.
 *  - Envoi des positions GPS : la plus récente seulement, jamais en rafale
 *    (une file hors-ligne enverrait des positions périmées et ferait échouer
 *    le contrôle anti-triche).
 */
import { AppError, toAppError } from "./errors";
import { ServerClock } from "./clock";
import { StreamSequencer } from "./sequencer";
import type { AbilityKey, DeviceFix, GameEvent } from "./types";
import { applyEvent, fromView, pruneExpired, streamsFor, withDevice, type GameState, type GameView } from "./state";

export interface GameApi {
  gameView: (id: string) => Promise<GameView>;
  serverTime: () => Promise<number>;
  tick: (id: string) => Promise<unknown>;
  heartbeat: (id: string) => Promise<{ server_now: number }>;
  reportPosition: (id: string, fix: DeviceFix) => Promise<{ accepted: boolean; out_of_zone?: boolean; server_now: number }>;
  capture: (id: string) => Promise<{ captured: string[]; cooldown_until: number; server_now: number }>;
  radar: (id: string) => Promise<{ at: number; uses: number }>;
  ability: (id: string, key: AbilityKey) => Promise<{ used_at: number; until: number | null; uses: number; result: Record<string, unknown> }>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  abort: (id: string) => Promise<void>;
  leaveGame: (id: string) => Promise<void>;
  safetyStop: (id: string) => Promise<void>;
}

export type UplinkStatus = "idle" | "sending" | "ok" | "rejected" | "offline";

export interface ControllerSnapshot {
  state: GameState | null;
  error: AppError | null;
  pending: string | null;
  uplink: { status: UplinkStatus; lastSentAt: number | null; lastError: string | null; outOfZone: boolean };
}

type Listener = () => void;

export class GameController {
  readonly clock = new ServerClock();
  private seq = new StreamSequencer<GameEvent>();
  private snapshot: ControllerSnapshot = {
    state: null,
    error: null,
    pending: null,
    uplink: { status: "idle", lastSentAt: null, lastError: null, outOfZone: false },
  };
  private listeners = new Set<Listener>();
  private loading = false;
  private reloadRequested = false;
  private buffer: GameEvent[] = [];
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private latestFix: DeviceFix | null = null;
  private sendingFix = false;
  onEvent: ((ev: GameEvent, s: GameState) => void) | null = null;
  onError: ((e: AppError) => void) | null = null;

  constructor(
    readonly gameId: string,
    private api: GameApi,
  ) {}

  setCallbacks(onEvent: GameController["onEvent"], onError: GameController["onError"]) {
    this.onEvent = onEvent;
    this.onError = onError;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;
  get state() {
    return this.snapshot.state;
  }

  private set(patch: Partial<ControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
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
      this.set({ state: fromView(view, this.snapshot.state?.device ?? null), error: null });
    } catch (e) {
      this.set({ error: toAppError(e) });
    } finally {
      this.loading = false;
    }
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

  prune(now: number) {
    const s = this.snapshot.state;
    if (!s) return;
    const p = pruneExpired(s, now);
    if (p !== s) this.set({ state: p });
  }

  nextDeadline(): number | null {
    const s = this.snapshot.state;
    if (!s || s.game.phase === "finished" || s.game.phase === "paused") return null;
    const c = [s.game.phase_ends_at, s.game.next_radar_at].filter((x): x is number => typeof x === "number");
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

  // ----- Positions GPS ----------------------------------------------------------
  /**
   * Reçoit une mesure GPS. Affichage local immédiat ; envoi au serveur de la
   * mesure la plus récente seulement (les précédentes non envoyées sont
   * abandonnées).
   */
  submitFix = (fix: DeviceFix) => {
    this.latestFix = fix;
    const s = this.snapshot.state;
    if (s) this.set({ state: withDevice(s, fix) });
    void this.flushFix();
  };

  private async flushFix() {
    if (this.sendingFix || !this.latestFix || this.disposed) return;
    const s = this.snapshot.state;
    if (!s || s.game.phase === "finished" || s.me.status !== "active") return;
    const fix = this.latestFix;
    this.latestFix = null;
    this.sendingFix = true;
    this.set({ uplink: { ...this.snapshot.uplink, status: "sending" } });
    try {
      // Horodatage converti sur l'horloge serveur (téléphones mal réglés).
      const serverTs = fix.timestamp + this.clock.offset;
      const r = await this.api.reportPosition(this.gameId, { ...fix, timestamp: serverTs });
      this.set({
        uplink: { status: "ok", lastSentAt: r.server_now, lastError: null, outOfZone: !!r.out_of_zone },
      });
    } catch (e) {
      const err = toAppError(e);
      const offline = err.code === "E_NETWORK";
      this.set({ uplink: { ...this.snapshot.uplink, status: offline ? "offline" : "rejected", lastError: err.code } });
      if (["E_NOT_ACTIVE", "E_GAME_FINISHED", "E_CONSENT_REQUIRED"].includes(err.code)) this.scheduleResync(0);
    } finally {
      this.sendingFix = false;
    }
    // Une mesure plus récente est arrivée pendant l'envoi.
    if (this.latestFix) void this.flushFix();
  }

  /** Vrai si le suivi doit tourner (partie en cours, joueur actif). */
  shouldTrack(): boolean {
    const s = this.snapshot.state;
    return !!s && s.game.phase !== "finished" && s.me.status === "active";
  }

  // ----- Actions ----------------------------------------------------------------
  private async act<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    this.set({ pending: name });
    try {
      return await fn();
    } catch (e) {
      const err = toAppError(e);
      this.onError?.(err);
      if (["E_NOT_ACTIVE", "E_PHASE"].includes(err.code)) this.scheduleResync(0);
      return null;
    } finally {
      this.set({ pending: null });
    }
  }

  capture = async (): Promise<string[] | null> => {
    const r = await this.act("capture", () => this.api.capture(this.gameId));
    const s = this.snapshot.state;
    if (r && s) this.set({ state: { ...s, me: { ...s.me, last_capture_at: r.server_now } } });
    return r ? r.captured : null;
  };

  ability = async (key: AbilityKey): Promise<boolean> => {
    const r = await this.act(`ability:${key}`, () => this.api.ability(this.gameId, key));
    const s = this.snapshot.state;
    if (r && s) {
      const prev = s.cooldowns[key];
      this.set({
        state: { ...s, cooldowns: { ...s.cooldowns, [key]: { last_used_at: r.used_at, uses: r.uses, until: r.until ?? prev?.until ?? null } } },
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
  safetyStop = async () => {
    this.latestFix = null;
    await this.act("safety", () => this.api.safetyStop(this.gameId));
    await this.load();
  };
}
