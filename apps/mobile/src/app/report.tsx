/** Signaler un joueur ou un problème (traité par les modérateurs, jamais public). */
import { toAppError } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Guard } from "../components/Guard";
import { Button, Field, Input, Notice, Panel, Screen, Segmented, T, useToast } from "../components/ui";
import { api, type RoomMember } from "../lib/api";
import { useAuth } from "../lib/auth";

const CATEGORIES = [
  { value: "unsafe", label: "Comportement dangereux" },
  { value: "cheating", label: "Triche" },
  { value: "behaviour", label: "Comportement" },
  { value: "name", label: "Pseudo inapproprié" },
  { value: "bug", label: "Bug" },
  { value: "other", label: "Autre" },
] as const;

export default function Report() {
  const { room, game, target } = useLocalSearchParams<{ room?: string; game?: string; target?: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [who, setWho] = useState<string>(target ?? "none");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("unsafe");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;
    api.roomState(room).then((s) => setMembers(s.members.filter((m) => m.user_id !== session?.user.id))).catch(() => undefined);
  }, [room, session?.user.id]);

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Signaler" }} />
        <T v="small">Votre signalement est transmis à l’équipe de modération, sans être montré au joueur concerné. En cas de danger immédiat, appelez le 112.</T>
        <Panel>
          {members.length ? (
            <Field label="Joueur concerné">
              <Segmented
                value={who}
                onChange={setWho}
                options={[{ value: "none", label: "Aucun" }, ...members.slice(0, 3).map((m) => ({ value: m.user_id, label: m.username }))]}
              />
            </Field>
          ) : null}
          {members.length > 3 ? (
            <T v="caption">Joueur absent de la liste ? Précisez son pseudo dans le message.</T>
          ) : null}
          <Field label="Motif">
            <Segmented value={category} onChange={setCategory} options={CATEGORIES.slice(0, 3).map((c) => ({ value: c.value, label: c.label.split(" ")[0] }))} />
          </Field>
          <Segmented value={category} onChange={setCategory} options={CATEGORIES.slice(3).map((c) => ({ value: c.value, label: c.label.split(" ")[0] }))} />
          <T v="caption">{CATEGORIES.find((c) => c.value === category)?.label}</T>
          <Field label="Que s'est-il passé ?">
            <Input value={message} onChangeText={setMessage} multiline maxLength={1000} style={{ minHeight: 100, textAlignVertical: "top", paddingTop: 12 }} />
          </Field>
          <Button
            label="Envoyer le signalement"
            loading={busy}
            disabled={message.trim().length < 5}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.reportPlayer(who === "none" ? null : who, category, message.trim(), game ?? null, room ?? null);
                toast.push("Signalement envoyé. Merci.", "success");
                router.back();
              } catch (e) {
                setError(toAppError(e).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Panel>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Screen>
    </Guard>
  );
}
