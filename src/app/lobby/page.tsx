"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Copy, Crown, LogOut, Play, Settings2, Share2, Shuffle, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfigSummary } from "@/components/ConfigEditor";
import { ConnectionBadge, RoomFrame } from "@/components/lobby/RoomFrame";
import { MemberActions } from "@/components/lobby/MemberActions";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Avatar, Button, ButtonLink, Notice, Panel, SectionTitle, Segmented, TeamTag, Toggle, cx } from "@/components/ui/primitives";
import { api, type RoomMember, type RoomState } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import type { Team } from "@/lib/engine/types";

function inviteLink(code: string) {
  return `${window.location.origin}/join/?code=${code}`;
}

function startBlockers(s: RoomState): string[] {
  const m = s.members;
  const out: string[] = [];
  if (m.length < 2) out.push("Il faut au moins 2 joueurs.");
  const unassigned = m.filter((x) => !x.team).length;
  if (unassigned) out.push(`${unassigned} joueur${unassigned > 1 ? "s" : ""} sans équipe.`);
  if (m.length >= 2 && !m.some((x) => x.team === "hunter")) out.push("Aucun Chasseur.");
  if (m.length >= 2 && !m.some((x) => x.team === "fugitive")) out.push("Aucun Fugitif.");
  return out;
}

function Invite({ code }: { code: string }) {
  const toast = useToast();
  const share = async () => {
    const url = inviteLink(code);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Rejoins mon salon", text: `Code du salon : ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.push("Lien d'invitation copié.", "success");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.push("Copie impossible : partagez le code manuellement.", "error");
    }
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.push("Code copié.", "success");
    } catch {
      toast.push("Copie impossible sur cet appareil.", "error");
    }
  };
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm text-fog">Code d&apos;invitation</p>
        <button type="button" onClick={copyCode} className="num flex items-center gap-2 text-4xl tracking-[0.2em] text-ivory" aria-label={`Copier le code ${code}`}>
          {code}
          <Copy className="size-4 text-fog" aria-hidden />
        </button>
      </div>
      <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={share}>
        Partager le lien
      </Button>
    </Panel>
  );
}

function MemberRow({
  m,
  online,
  meId,
  canManage,
  onManage,
}: {
  m: RoomMember;
  online: boolean;
  meId: string;
  canManage: boolean;
  onManage: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="relative">
        <Avatar avatar={m.avatar} size={38} />
        <span
          className={cx("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-graphite", online ? "bg-fugitive" : "bg-fog-2")}
          aria-label={online ? "En ligne" : "Hors ligne"}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">
          {m.username}
          {m.user_id === meId ? <span className="text-xs font-normal text-fog">(vous)</span> : null}
          {m.is_host ? <Crown className="size-3.5 text-warn" aria-label="Hôte" /> : null}
        </p>
        <p className="text-xs text-fog">{m.is_ready ? "Prêt" : online ? "En ligne" : "Hors ligne"}</p>
      </div>
      <TeamTag team={m.team} />
      {canManage && m.user_id !== meId ? (
        <Button variant="ghost" size="sm" onClick={onManage} aria-label={`Gérer ${m.username}`}>
          Gérer
        </Button>
      ) : null}
    </li>
  );
}

function LobbyInner() {
  const router = useRouter();
  const toast = useToast();
  const [managing, setManaging] = useState<RoomMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <RoomFrame>
      {({ state, online, channel, roomId, userId, isHost, lastEvent }) => {
        const s = state!;
        const me = s.members.find((m) => m.user_id === userId);
        const blockers = startBlockers(s);
        const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
          setBusy(key);
          try {
            await fn();
            if (success) toast.push(success, "success");
          } catch (e) {
            toast.push(toAppError(e).message, "error");
          } finally {
            setBusy(null);
          }
        };
        return (
          <>
            <RedirectOnGame state={s} lastEvent={lastEvent} />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold">{s.room.name}</h1>
                <div className="mt-1 flex items-center gap-3">
                  <ConnectionBadge status={channel} />
                  <span className="text-xs text-fog">
                    {s.members.length}/{s.room.max_players} joueurs
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => setConfirmLeave(true)}>
                Quitter
              </Button>
            </div>

            {s.room.status === "playing" && s.game ? (
              <Notice>
                Une partie est en cours.{" "}
                {s.game.participant ? (
                  <a className="underline" href={`/game/?id=${s.game.id}`}>
                    Reprendre la partie
                  </a>
                ) : (
                  "Vous rejoindrez la prochaine."
                )}
              </Notice>
            ) : null}
            {s.room.status === "results" && s.game ? (
              <Panel className="flex flex-wrap items-center justify-between gap-3">
                <p>La partie est terminée.</p>
                <div className="flex gap-2">
                  <ButtonLink href={`/results/?id=${s.game.id}`} variant="secondary">
                    Voir les résultats
                  </ButtonLink>
                  {isHost ? (
                    <Button loading={busy === "lobby"} onClick={() => run("lobby", () => api.returnToLobby(roomId))}>
                      Nouvelle partie
                    </Button>
                  ) : null}
                </div>
              </Panel>
            ) : null}

            <Invite code={s.room.code} />

            {me && s.room.status === "lobby" ? (
              <Panel className="space-y-4">
                <SectionTitle>Votre équipe</SectionTitle>
                {s.room.allow_team_choice || isHost ? (
                  <Segmented
                    label="Choisir son équipe"
                    value={(me.team ?? "none") as Team | "none"}
                    onChange={(v) =>
                      run("team", () =>
                        isHost ? api.setMemberTeam(roomId, userId, v === "none" ? null : v) : api.chooseTeam(roomId, v === "none" ? null : v),
                      )
                    }
                    options={[
                      { value: "hunter", label: "Chasseur" },
                      { value: "fugitive", label: "Fugitif" },
                      { value: "none", label: "Indécis" },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-fog">
                    L&apos;hôte répartit les équipes. Vous êtes : <TeamTag team={me.team} className="ml-1" />
                  </p>
                )}
                <Toggle label="Je suis prêt" checked={me.is_ready} onChange={(v) => run("ready", () => api.setReady(roomId, v))} />
              </Panel>
            ) : null}

            <Panel className="p-0 sm:p-0">
              <div className="flex items-center justify-between px-4 pb-1 pt-4">
                <h2 className="font-semibold">Joueurs</h2>
                {isHost && s.room.status === "lobby" ? (
                  <ButtonLink href={`/lobby/teams/?room=${roomId}`} variant="ghost" size="sm" icon={<Users className="size-4" />}>
                    Équipes
                  </ButtonLink>
                ) : null}
              </div>
              <ul className="divide-y divide-line">
                {s.members.map((m) => (
                  <MemberRow
                    key={m.user_id}
                    m={m}
                    meId={userId}
                    online={online.has(m.user_id)}
                    canManage={isHost}
                    onManage={() => setManaging(m)}
                  />
                ))}
              </ul>
            </Panel>

            <Panel>
              <SectionTitle
                action={
                  isHost && s.room.status === "lobby" ? (
                    <ButtonLink href={`/lobby/config/?room=${roomId}`} variant="ghost" size="sm" icon={<Settings2 className="size-4" />}>
                      Modifier
                    </ButtonLink>
                  ) : null
                }
              >
                Règles
              </SectionTitle>
              <ConfigSummary config={s.room.config} />
            </Panel>

            {isHost && s.room.status === "lobby" ? (
              <div className="sticky bottom-20 z-10 space-y-2 md:bottom-4">
                {blockers.length ? (
                  <div className="rounded-[var(--radius-control)] bg-graphite px-4 py-3 text-sm text-fog">
                    {blockers.join(" ")}
                    {s.members.length >= 2 ? (
                      <button className="ml-2 inline-flex items-center gap-1 text-volt" onClick={() => run("auto", () => api.autoAssign(roomId), "Équipes réparties.")}>
                        <Shuffle className="size-3.5" aria-hidden /> Répartir au hasard
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <Button
                  size="lg"
                  block
                  icon={<Play className="size-4" />}
                  disabled={blockers.length > 0}
                  loading={busy === "start"}
                  onClick={() =>
                    run("start", async () => {
                      const r = await api.startGame(roomId);
                      router.push(`/game/?id=${r.game_id}`);
                    })
                  }
                >
                  Lancer la partie
                </Button>
              </div>
            ) : s.room.status === "lobby" ? (
              <p className="text-center text-sm text-fog">En attente du lancement par l&apos;hôte.</p>
            ) : null}

            <MemberActions roomId={roomId} member={managing} onClose={() => setManaging(null)} inLobby={s.room.status === "lobby"} />
            <Dialog
              open={confirmLeave}
              onOpenChange={setConfirmLeave}
              title="Quitter le salon ?"
              description={
                s.room.status === "playing"
                  ? "Une partie est en cours : vous serez compté comme ayant abandonné."
                  : isHost
                    ? "Le rôle d'hôte sera transmis au joueur présent depuis le plus longtemps."
                    : "Vous pourrez revenir avec le code tant que le salon est ouvert."
              }
              footer={
                <>
                  <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
                    Rester
                  </Button>
                  <Button
                    variant="danger"
                    loading={busy === "leave"}
                    onClick={() =>
                      run("leave", async () => {
                        await api.leaveRoom(roomId);
                        router.replace("/");
                      })
                    }
                  >
                    Quitter le salon
                  </Button>
                </>
              }
            />
          </>
        );
      }}
    </RoomFrame>
  );
}

/** Redirige automatiquement les participants quand l'hôte lance la partie. */
function RedirectOnGame({ state, lastEvent }: { state: RoomState; lastEvent: { t: string; d: Record<string, unknown> } | null }) {
  const router = useRouter();
  const gameId = state.room.status === "playing" && state.game?.participant ? state.game.id : null;
  const started = lastEvent?.t === "game_started";
  useEffect(() => {
    if (gameId && started) router.push(`/game/?id=${gameId}`);
  }, [gameId, started, router]);
  return null;
}

export default function LobbyPage() {
  return (
    <AppShell>
      <Suspense>
        <LobbyInner />
      </Suspense>
    </AppShell>
  );
}
