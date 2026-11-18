/**
 * Synchronisation d'horloge client/serveur (type NTP simplifié).
 * Le chronomètre affiché ne dépend jamais de l'horloge locale du téléphone :
 * serverNow() = Date.now() + offset estimé.
 */
export interface ClockSample {
  /** décalage estimé serveur - client (ms) */
  offset: number;
  /** aller-retour (ms) */
  rtt: number;
}

export function sampleFrom(t0: number, server: number, t1: number): ClockSample {
  const rtt = Math.max(0, t1 - t0);
  return { offset: server - (t0 + rtt / 2), rtt };
}

/** Retient l'offset des échantillons au plus faible RTT (les plus fiables). */
export function bestOffset(samples: readonly ClockSample[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);
  const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

export class ServerClock {
  private samples: ClockSample[] = [];
  offset = 0;

  add(sample: ClockSample) {
    this.samples.push(sample);
    if (this.samples.length > 12) this.samples.shift();
    this.offset = bestOffset(this.samples);
  }

  /** Corrige à partir d'un horodatage serveur reçu avec une réponse RPC. */
  observe(t0: number, server: number, t1: number) {
    this.add(sampleFrom(t0, server, t1));
  }

  now(): number {
    return Date.now() + this.offset;
  }

  get quality(): { rtt: number | null; samples: number } {
    if (!this.samples.length) return { rtt: null, samples: 0 };
    return { rtt: Math.min(...this.samples.map((s) => s.rtt)), samples: this.samples.length };
  }
}
