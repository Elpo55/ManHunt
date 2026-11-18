"use client";
/** Cadre commun aux pages de salon : chargement, erreurs, état de connexion. */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "../providers/AuthProvider";
import { ButtonLink, FullScreenStatus, Notice, Spinner, cx } from "../ui/primitives";
import { useRoom, type RoomHook } from "@/lib/realtime/useRoom";
import { isUuid, useQueryParam } from "@/lib/useQueryParam";
import type { ChannelStatus } from "@/lib/realtime/useChannel";

export function ConnectionBadge({ status }: { status: ChannelStatus }) {
  const map: Record<ChannelStatus, [string, string]> = {
    live: ["En direct", "bg-fugitive"],
    connecting: ["Connexion…", "bg-warn"],
    retrying: ["Reconnexion…", "bg-warn"],
    offline: ["Hors ligne", "bg-hunter"],
  };
  const [label, dot] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fog" role="status">
      <span className={cx("size-1.5 rounded-full", dot, status === "live" && "live-dot")} />
      {label}
    </span>
  );
}

export function RoomFrame({
  children,
  back,
}: {
  children: (ctx: RoomHook & { roomId: string; userId: string; isHost: boolean }) => ReactNode;
  back?: { href: string; label: string };
}) {
  const roomParam = useQueryParam("room");
  const roomId = isUuid(roomParam) ? roomParam : null;
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const room = useRoom(roomId, userId);

  if (!roomId) {
    return (
      <FullScreenStatus title="Lien de salon invalide">
        <ButtonLink href="/join/">Saisir un code</ButtonLink>
      </FullScreenStatus>
    );
  }
  const fatal = room.error && (!room.state || ["E_NOT_MEMBER", "E_ROOM_NOT_FOUND"].includes(room.error.code));
  if (fatal && room.error) {
    return (
      <FullScreenStatus title="Salon inaccessible">
        <Notice tone="error">{room.error.message}</Notice>
        <ButtonLink href="/" variant="secondary">
          Retour à l&apos;accueil
        </ButtonLink>
      </FullScreenStatus>
    );
  }
  if (!room.state || !userId) return <Spinner label="Chargement du salon" />;

  const isHost = room.state.room.host_id === userId;
  return (
    <div className="space-y-5">
      {back ? (
        <Link href={back.href || `/lobby/?room=${roomId}`} className="-ml-1 inline-flex items-center gap-1.5 text-sm text-fog hover:text-ivory">
          <ArrowLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      {room.error ? <Notice tone="error">{room.error.message}</Notice> : null}
      {children({ ...room, roomId, userId, isHost })}
    </div>
  );
}
