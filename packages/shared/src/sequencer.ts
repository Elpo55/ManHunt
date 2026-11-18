/**
 * Ordonnancement des événements Realtime par flux.
 *
 * Chaque flux (all, hunter, fugitive, p:<uid>) porte un numéro de séquence
 * strictement croissant attribué par le serveur. Le séquenceur :
 *  - ignore les doublons et les messages en retard (sn <= dernier appliqué),
 *  - applique les messages consécutifs,
 *  - met en attente un message en avance et signale un trou ; si le trou
 *    n'est pas comblé rapidement, le client déclenche une resynchronisation.
 */
export type SequencerResult<T> =
  | { kind: "apply"; events: T[] }
  | { kind: "duplicate" }
  | { kind: "gap"; missingFrom: number };

export class StreamSequencer<T extends { s: string; sn: number }> {
  private last = new Map<string, number>();
  private pending = new Map<string, Map<number, T>>();

  /** Initialise (ou réinitialise) les positions après une resynchronisation. */
  reset(positions: Record<string, number>) {
    this.last = new Map(Object.entries(positions));
    this.pending.clear();
  }

  position(stream: string): number | undefined {
    return this.last.get(stream);
  }

  push(ev: T): SequencerResult<T> {
    const last = this.last.get(ev.s);
    if (last === undefined) {
      // Flux inconnu (pas encore synchronisé) : on accepte comme point de départ.
      this.last.set(ev.s, ev.sn);
      return { kind: "apply", events: [ev] };
    }
    if (ev.sn <= last) return { kind: "duplicate" };
    if (ev.sn > last + 1) {
      let buf = this.pending.get(ev.s);
      if (!buf) this.pending.set(ev.s, (buf = new Map()));
      buf.set(ev.sn, ev);
      return { kind: "gap", missingFrom: last + 1 };
    }
    const out: T[] = [ev];
    let cur = ev.sn;
    const buf = this.pending.get(ev.s);
    while (buf?.has(cur + 1)) {
      out.push(buf.get(cur + 1)!);
      buf.delete(cur + 1);
      cur++;
    }
    this.last.set(ev.s, cur);
    return { kind: "apply", events: out };
  }

  hasPending(): boolean {
    for (const b of this.pending.values()) if (b.size) return true;
    return false;
  }
}
