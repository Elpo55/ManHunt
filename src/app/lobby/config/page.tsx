"use client";
import { Suspense, useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfigEditor } from "@/components/ConfigEditor";
import { RoomFrame } from "@/components/lobby/RoomFrame";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Button, Field, Input, Notice, Panel, RangeField, SectionTitle, Toggle } from "@/components/ui/primitives";
import { api, type RoomState } from "@/lib/api";
import { normalizeConfig } from "@/lib/engine/config";
import type { GameConfig } from "@/lib/engine/types";
import { toAppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

interface Saved {
  id: string;
  name: string;
  config: GameConfig;
}

function SavedConfigs({ current, onLoad }: { current: GameConfig; onLoad: (c: GameConfig) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Saved[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data, error } = await getSupabase()!.from("saved_game_configs").select("id,name,config").order("updated_at", { ascending: false });
    if (!error) setItems((data as Saved[]) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const sb = getSupabase()!;
    const { error } = await sb.from("saved_game_configs").upsert({ name: name.trim(), config: current }, { onConflict: "owner_id,name" });
    if (error) toast.push(error.message.includes("E_TOO_MANY") ? "Limite de 20 configurations atteinte." : "Enregistrement impossible.", "error");
    else {
      toast.push("Configuration enregistrée.", "success");
      setOpen(false);
      setName("");
      void load();
    }
  };
  const remove = async (id: string) => {
    const { error } = await getSupabase()!.from("saved_game_configs").delete().eq("id", id);
    if (error) toast.push("Suppression impossible.", "error");
    else setItems((cur) => cur.filter((i) => i.id !== id));
  };

  return (
    <Panel>
      <SectionTitle action={<Button variant="ghost" size="sm" icon={<Save className="size-4" />} onClick={() => setOpen(true)}>Enregistrer</Button>}>
        Mes configurations
      </SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-fog">Enregistrez ces règles pour les réutiliser dans vos prochains salons.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-slate pl-4">
              <span className="flex-1 truncate text-sm">{i.name}</span>
              <Button variant="ghost" size="sm" onClick={() => onLoad(normalizeConfig(i.config))}>
                Appliquer
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Supprimer ${i.name}`} onClick={() => remove(i.id)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Enregistrer la configuration"
        footer={
          <Button disabled={!name.trim()} onClick={save}>
            Enregistrer
          </Button>
        }
      >
        <Field label="Nom" htmlFor="cfg-name" hint="Un nom existant sera remplacé.">
          <Input id="cfg-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Dialog>
    </Panel>
  );
}

function Editor({ s, roomId, isHost }: { s: RoomState; roomId: string; isHost: boolean }) {
  const toast = useToast();
  const [config, setConfig] = useState<GameConfig>(normalizeConfig(s.room.config));
  const [name, setName] = useState(s.room.name);
  const [maxPlayers, setMaxPlayers] = useState(s.room.max_players);
  const [allowChoice, setAllowChoice] = useState(s.room.allow_team_choice);
  const [busy, setBusy] = useState(false);
  const editable = isHost && s.room.status === "lobby";
  const dirty =
    JSON.stringify(config) !== JSON.stringify(normalizeConfig(s.room.config)) ||
    name !== s.room.name ||
    maxPlayers !== s.room.max_players ||
    allowChoice !== s.room.allow_team_choice;

  const save = async () => {
    setBusy(true);
    try {
      await api.updateRoomSettings(roomId, { name: name.trim(), config, maxPlayers, allowTeamChoice: allowChoice });
      toast.push("Règles enregistrées. Les joueurs doivent se déclarer prêts à nouveau.", "success");
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">Configuration de la partie</h1>
      {!editable ? <Notice>Seul l&apos;hôte peut modifier les règles, et uniquement avant le lancement.</Notice> : null}
      <Panel className="space-y-4">
        <SectionTitle>Salon</SectionTitle>
        <Field label="Nom du salon" htmlFor="room-name">
          <Input id="room-name" disabled={!editable} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <RangeField label="Joueurs maximum" value={maxPlayers} min={Math.max(2, s.members.length)} max={20} disabled={!editable} onChange={setMaxPlayers} />
        <Toggle label="Les joueurs choisissent leur équipe" checked={allowChoice} disabled={!editable} onChange={setAllowChoice} />
      </Panel>
      <ConfigEditor value={config} onChange={setConfig} disabled={!editable} />
      {isHost ? <SavedConfigs current={config} onLoad={setConfig} /> : null}
      {editable ? (
        <div className="sticky bottom-20 z-10 md:bottom-4">
          <Button size="lg" block disabled={!dirty} loading={busy} onClick={save}>
            {dirty ? "Enregistrer les règles" : "Règles à jour"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ConfigInner() {
  return (
    <RoomFrame back={{ href: "", label: "Retour au salon" }}>
      {({ state, roomId, isHost }) => <Editor key={state!.room.id} s={state!} roomId={roomId} isHost={isHost} />}
    </RoomFrame>
  );
}

export default function ConfigPage() {
  return (
    <AppShell>
      <Suspense>
        <ConfigInner />
      </Suspense>
    </AppShell>
  );
}
