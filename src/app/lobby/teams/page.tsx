"use client";
import { Suspense, useState } from "react";
import { ArrowLeftRight, Shuffle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RoomFrame } from "@/components/lobby/RoomFrame";
import { useToast } from "@/components/ui/overlay";
import { Avatar, Button, Notice, Panel, cx } from "@/components/ui/primitives";
import { api, type RoomMember } from "@/lib/api";
import { TEAM_LABEL } from "@/lib/engine/rules";
import type { Team } from "@/lib/engine/types";
import { toAppError } from "@/lib/errors";

function Column({
  title,
  team,
  members,
  canEdit,
  onMove,
  busy,
}: {
  title: string;
  team: Team | null;
  members: RoomMember[];
  canEdit: boolean;
  onMove: (m: RoomMember, to: Team | null) => void;
  busy: string | null;
}) {
  return (
    <Panel className="p-0 sm:p-0">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className={cx("font-semibold", team === "hunter" && "text-hunter", team === "fugitive" && "text-fugitive")}>{title}</h2>
        <span className="num text-fog">{members.length}</span>
      </div>
      {members.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-fog">Personne pour l&apos;instant.</p>
      ) : (
        <ul className="py-2">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-2">
              <Avatar avatar={m.avatar} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm">{m.username}</span>
              {canEdit ? (
                <div className="flex gap-1">
                  {(["hunter", "fugitive", null] as (Team | null)[])
                    .filter((t) => t !== team)
                    .map((t) => (
                      <Button
                        key={String(t)}
                        variant="ghost"
                        size="sm"
                        loading={busy === `${m.user_id}:${t}`}
                        onClick={() => onMove(m, t)}
                        aria-label={`Déplacer ${m.username} vers ${t ? TEAM_LABEL[t] : "sans équipe"}`}
                      >
                        {t === "hunter" ? "Chasseur" : t === "fugitive" ? "Fugitif" : "Retirer"}
                      </Button>
                    ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TeamsInner() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <RoomFrame back={{ href: "", label: "Retour au salon" }}>
      {({ state, roomId, isHost, userId }) => {
        const s = state!;
        const canEdit = isHost && s.room.status === "lobby";
        const run = async (key: string, fn: () => Promise<unknown>) => {
          setBusy(key);
          try {
            await fn();
          } catch (e) {
            toast.push(toAppError(e).message, "error");
          } finally {
            setBusy(null);
          }
        };
        const move = (m: RoomMember, to: Team | null) =>
          run(`${m.user_id}:${to}`, () =>
            canEdit ? api.setMemberTeam(roomId, m.user_id, to) : api.chooseTeam(roomId, to),
          );
        const by = (t: Team | null) => s.members.filter((m) => m.team === t);
        const hunters = by("hunter").length;
        const fugitives = by("fugitive").length;
        return (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Sélection des équipes</h1>
                <p className="mt-1 text-sm text-fog">
                  Conseil : environ un Chasseur pour deux ou trois Fugitifs.
                </p>
              </div>
              {canEdit ? (
                <Button variant="secondary" icon={<Shuffle className="size-4" />} loading={busy === "auto"} onClick={() => run("auto", () => api.autoAssign(roomId))}>
                  Répartir au hasard
                </Button>
              ) : null}
            </div>
            {!canEdit ? (
              s.room.allow_team_choice ? (
                <Notice>Choisissez votre équipe ; seul l&apos;hôte peut déplacer les autres joueurs.</Notice>
              ) : (
                <Notice>L&apos;hôte répartit les équipes de ce salon.</Notice>
              )
            ) : null}
            <div className="flex items-center gap-2 text-sm text-fog">
              <ArrowLeftRight className="size-4" aria-hidden />
              {hunters} Chasseur{hunters > 1 ? "s" : ""} contre {fugitives} Fugitif{fugitives > 1 ? "s" : ""}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {([["Chasseurs", "hunter"], ["Fugitifs", "fugitive"], ["Sans équipe", null]] as [string, Team | null][]).map(([title, t]) => (
                <Column
                  key={title}
                  title={title}
                  team={t}
                  members={by(t)}
                  busy={busy}
                  canEdit={canEdit}
                  onMove={move}
                />
              ))}
            </div>
            {!canEdit && s.room.allow_team_choice && s.room.status === "lobby" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => move(s.members.find((m) => m.user_id === userId)!, "hunter")}>
                  Je serai Chasseur
                </Button>
                <Button variant="secondary" onClick={() => move(s.members.find((m) => m.user_id === userId)!, "fugitive")}>
                  Je serai Fugitif
                </Button>
              </div>
            ) : null}
          </>
        );
      }}
    </RoomFrame>
  );
}

export default function TeamsPage() {
  return (
    <AppShell wide>
      <Suspense>
        <TeamsInner />
      </Suspense>
    </AppShell>
  );
}
