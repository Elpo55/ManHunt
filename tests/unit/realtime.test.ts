import { describe, expect, it } from "vitest";
import { StreamSequencer } from "@/lib/realtime/sequencer";
import { ServerClock, bestOffset, sampleFrom } from "@/lib/realtime/clock";

type Ev = { s: string; sn: number; id: string };
const ev = (s: string, sn: number): Ev => ({ s, sn, id: `${s}#${sn}` });

describe("séquenceur de flux", () => {
  it("applique dans l'ordre, ignore doublons et retards", () => {
    const q = new StreamSequencer<Ev>();
    q.reset({ all: 3, hunter: 10 });
    expect(q.push(ev("all", 4))).toEqual({ kind: "apply", events: [ev("all", 4)] });
    expect(q.push(ev("all", 4))).toEqual({ kind: "duplicate" });
    expect(q.push(ev("all", 2))).toEqual({ kind: "duplicate" });
    expect(q.push(ev("hunter", 11)).kind).toBe("apply");
  });

  it("détecte un trou puis réordonne quand il est comblé", () => {
    const q = new StreamSequencer<Ev>();
    q.reset({ all: 1 });
    expect(q.push(ev("all", 3))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(q.push(ev("all", 4))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(q.hasPending()).toBe(true);
    const r = q.push(ev("all", 2));
    expect(r).toEqual({ kind: "apply", events: [ev("all", 2), ev("all", 3), ev("all", 4)] });
    expect(q.position("all")).toBe(4);
    expect(q.hasPending()).toBe(false);
  });

  it("les flux sont indépendants", () => {
    const q = new StreamSequencer<Ev>();
    q.reset({ all: 0, fugitive: 0 });
    expect(q.push(ev("fugitive", 1)).kind).toBe("apply");
    expect(q.push(ev("all", 2)).kind).toBe("gap");
    expect(q.push(ev("fugitive", 2)).kind).toBe("apply");
  });
});

describe("horloge serveur", () => {
  it("estime le décalage au milieu de l'aller-retour", () => {
    expect(sampleFrom(1000, 5100, 1200)).toEqual({ offset: 4000, rtt: 200 });
  });

  it("privilégie les échantillons à faible latence", () => {
    const off = bestOffset([
      { offset: 4000, rtt: 40 },
      { offset: 4010, rtt: 50 },
      { offset: 6000, rtt: 900 },
      { offset: 3000, rtt: 800 },
    ]);
    expect(off).toBeGreaterThanOrEqual(4000);
    expect(off).toBeLessThanOrEqual(4010);
  });

  it("ServerClock.now() suit le décalage", () => {
    const c = new ServerClock();
    const t = Date.now();
    c.observe(t, t + 60_000, t);
    expect(Math.abs(c.now() - (Date.now() + 60_000))).toBeLessThan(50);
    expect(c.quality.samples).toBe(1);
  });
});
