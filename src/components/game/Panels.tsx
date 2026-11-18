"use client";
/** Panneaux d'information de partie : équipe, radar, journal, scores. */
import { Crown, Radio, WifiOff } from "lucide-react";
import { Avatar, TeamTag, cx } from "../ui/primitives";
import { describeEvent } from "@/lib/game/journal";
import type { GameState } from "@/lib/game/state";
import { PRECISION_LABEL, TEAM_LABEL, describeContact, formatClock } from "@/lib/engine/rules";
import type { Team } from "@/lib/engine/types";

const TONE: Record<string, string> = {
  neutral: "text-fog",
  hunter: "text-hunter",
  fugitive: "text-fugitive",
  alert: "text-warn",
  accent: "text-ivory",
};

export function JournalPanel({ state, limit = 40 }: { state: GameState; limit?: number }) {
  const lines = state.journal
    .map((ev) => ({ ev, line: describeEvent(ev, state) }))
    .filter((x) => x.line)
    .slice(-limit)
    .reverse();
  if (!lines.length) return <p className="text-sm text-fog">Les événements de la partie apparaîtront ici.</p>;
  return (
    <ol className="space-y-2.5" aria-live="polite">
      {lines.map(({ ev, line }) => (
        <li key={`${ev.s}:${ev.sn}`} className="flex gap-3 text-sm">
          <time className="num w-12 shrink-0 text-xs text-fog-2">
            {new Date(ev.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).slice(3)}
          </time>
          <span className={cx(TONE[line!.tone])}>{line!.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function PlayersPanel({ state, online, hostId }: { state: GameState; online: Set<string>; hostId: string }) {
  const teams: Team[] = state.me.team === "hunter" ? ["hunter", "fugitive"] : ["fugitive", "hunter"];
  return (
    <div className="space-y-5">
      {teams.map((t) => {
        const list = Object.values(state.players).filter((p) => p.team === t);
        const active = list.filter((p) => p.status === "active").length;
        return (
          <section key={t}>
            <h3 className={cx("mb-2 flex items-center justify-between text-sm font-semibold", t === "hunter" ? "text-hunter" : "text-fugitive")}>
              {TEAM_LABEL[t]}
              <span className="num text-xs text-fog">
                {active}/{list.length} en jeu
              </span>
            </h3>
            <ul className="space-y-1.5">
              {list.map((p) => (
                <li key={p.u} className={cx("flex items-center gap-2.5 text-sm", p.status !== "active" && "opacity-50")}>
                  <Avatar avatar={p.avatar} size={26} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.username}
                    {p.u === state.me.u ? <span className="text-fog"> (vous)</span> : null}
                  </span>
                  {p.u === hostId ? <Crown className="size-3.5 text-warn" aria-label="Hôte" /> : null}
                  {p.captures ? <span className="num text-xs text-hunter">{p.captures}</span> : null}
                  {p.status === "captured" ? <span className="text-xs text-fog">capturé</span> : null}
                  {p.status === "abandoned" ? <span className="text-xs text-fog">abandon</span> : null}
                  {p.status === "active" && (!p.connected || (!online.has(p.u) && online.size > 0)) ? (
                    <WifiOff className="size-3.5 text-fog" aria-label="Déconnecté" />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function RadarPanel({ state, now }: { state: GameState; now: number }) {
  const cfg = state.game.config.radar;
  const equipped = cfg.enabled && (cfg.teams === "both" || cfg.teams === state.me.team);
  const r = state.radar;
  return (
    <div className="space-y-3 text-sm">
      {!cfg.enabled ? (
        <p className="text-fog">Radar désactivé pour cette partie.</p>
      ) : !equipped ? (
        <p className="text-fog">Votre équipe n&apos;a pas de radar. Vous serez averti des impulsions adverses.</p>
      ) : (
        <p className="text-fog">
          {PRECISION_LABEL[cfg.precision]} ·{" "}
          {cfg.mode === "auto"
            ? state.game.next_radar_at && state.game.phase === "running"
              ? `prochaine impulsion dans ${formatClock(state.game.next_radar_at - now)}`
              : `toutes les ${cfg.interval_s} s`
            : "déclenchement manuel"}
        </p>
      )}
      {r && r.expires_at > now ? (
        <div className="rounded-[var(--radius-control)] bg-slate p-3">
          <p className="mb-2 flex items-center gap-2 font-medium">
            <Radio className="size-4 text-volt" aria-hidden />
            Impulsion {r.kind === "manual" ? "manuelle" : "automatique"} · {r.contacts.length} contact{r.contacts.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-1 text-fog">
            {r.contacts.map((c, i) => (
              <li key={i}>{describeContact(c)}</li>
            ))}
            {!r.contacts.length ? <li>Aucun adversaire actif.</li> : null}
          </ul>
        </div>
      ) : null}
      {state.radarPings.length ? (
        <p className="text-warn">Dernière impulsion adverse il y a {Math.max(0, Math.round((now - state.radarPings[state.radarPings.length - 1]) / 1000))} s.</p>
      ) : null}
    </div>
  );
}

export function Scoreboard({ state }: { state: GameState }) {
  const rows = Object.values(state.players).sort(
    (a, b) => (a.team === b.team ? b.captures - a.captures : a.team === "hunter" ? -1 : 1),
  );
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-fog">
          <th className="py-2 font-normal">Joueur</th>
          <th className="py-2 font-normal">Équipe</th>
          <th className="py-2 font-normal">État</th>
          <th className="py-2 text-right font-normal">Captures</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((p) => (
          <tr key={p.u}>
            <td className="py-2.5">
              <span className="flex items-center gap-2">
                <Avatar avatar={p.avatar} size={24} />
                <span className="truncate">{p.username}</span>
              </span>
            </td>
            <td className="py-2.5">
              <TeamTag team={p.team} />
            </td>
            <td className="py-2.5 text-fog">
              {p.status === "active" ? (p.connected ? "En jeu" : "Déconnecté") : p.status === "captured" ? "Capturé" : "Abandon"}
            </td>
            <td className="num py-2.5 text-right">{p.captures}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
