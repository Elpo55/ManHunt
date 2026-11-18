"use client";
import { useState } from "react";
import { Dialog, useToast } from "../ui/overlay";
import { Avatar, Button, Segmented, Toggle } from "../ui/primitives";
import { api, type RoomMember } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import type { Team } from "@/lib/engine/types";

/** Actions de l'hôte sur un membre : équipe, transfert d'hôte, exclusion. */
export function MemberActions({
  roomId,
  member,
  onClose,
  inLobby,
}: {
  roomId: string;
  member: RoomMember | null;
  onClose: () => void;
  inLobby: boolean;
}) {
  const toast = useToast();
  const [ban, setBan] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.push(msg, "success");
      onClose();
      setConfirmKick(false);
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!member) return null;
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()} title={member.username}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar avatar={member.avatar} size={44} />
          <p className="text-sm text-fog">{member.is_guest ? "Profil invité" : "Compte enregistré"}</p>
        </div>
        {inLobby ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Équipe</p>
            <Segmented
              label="Équipe du joueur"
              value={(member.team ?? "none") as Team | "none"}
              onChange={(v) =>
                run("team", () => api.setMemberTeam(roomId, member.user_id, v === "none" ? null : v), "Équipe modifiée.")
              }
              options={[
                { value: "hunter", label: "Chasseur" },
                { value: "fugitive", label: "Fugitif" },
                { value: "none", label: "Aucune" },
              ]}
            />
          </div>
        ) : null}
        <Button
          variant="secondary"
          block
          loading={busy === "host"}
          onClick={() => run("host", () => api.transferHost(roomId, member.user_id), `${member.username} est maintenant l'hôte.`)}
        >
          Lui transmettre le rôle d&apos;hôte
        </Button>
        {confirmKick ? (
          <div className="space-y-3 rounded-[var(--radius-control)] bg-slate p-4">
            <Toggle label="Interdire de revenir" description="Le code ne fonctionnera plus pour ce joueur." checked={ban} onChange={setBan} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmKick(false)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={busy === "kick"}
                onClick={() => run("kick", () => api.kick(roomId, member.user_id, ban), `${member.username} a été exclu.`)}
              >
                Confirmer
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmKick(true)}>
            Exclure du salon
          </Button>
        )}
      </div>
    </Dialog>
  );
}
