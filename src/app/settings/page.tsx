"use client";
import { useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/overlay";
import { Button, Notice, Panel, SectionTitle, Stat, Toggle } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { metrics } from "@/lib/metrics";
import { updateSettings, useSettings } from "@/lib/settings";
import { APP_NAME } from "@/lib/supabase";

function Diagnostics() {
  const m = useSyncExternalStore(metrics.subscribe, metrics.get, metrics.get);
  const minutes = Math.max(1, (m.at - m.startedAt) / 60000);
  return (
    <Panel>
      <SectionTitle>Diagnostic de cette session</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Appels serveur" value={m.rpcCalls} sub={`${(m.rpcCalls / minutes).toFixed(1)} / min`} />
        <Stat label="Erreurs" value={m.rpcErrors} />
        <Stat label="Messages temps réel reçus" value={m.realtimeReceived} />
        <Stat label="Resynchronisations" value={m.resyncs} />
        <Stat label="Reconnexions" value={m.reconnects} />
        <Stat label="Dernière latence" value={m.lastRttMs !== null ? `${m.lastRttMs} ms` : "—"} />
      </div>
    </Panel>
  );
}

type Usage = {
  database_bytes: number;
  profiles: number;
  rooms_open: number;
  games_total: number;
  games_live: number;
  events_total: number;
  month_delivered_estimate: number;
  daily: { day: string; rpc_calls: number; broadcasts: number; delivered_estimate: number }[];
};

function AdminUsage() {
  const toast = useToast();
  const [u, setU] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setU((await api.usageStats()) as unknown as Usage);
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const cleanup = async () => {
    try {
      const r = await api.adminCleanup();
      toast.push(`Nettoyage : ${r.events_deleted} événements supprimés, ${r.rooms_closed} salons fermés.`, "success");
      void load();
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} Mo`;
  return (
    <Panel>
      <SectionTitle>Administration : consommation des quotas</SectionTitle>
      {!u ? (
        <Button variant="secondary" loading={busy} onClick={load}>
          Charger les statistiques serveur
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Base de données" value={mb(u.database_bytes)} sub="limite gratuite : 500 Mo" />
            <Stat label="Messages Realtime (mois, estimés)" value={u.month_delivered_estimate.toLocaleString("fr-FR")} sub="limite gratuite : 2 millions" />
            <Stat label="Parties" value={u.games_total} sub={`${u.games_live} en cours`} />
            <Stat label="Profils" value={u.profiles} />
            <Stat label="Salons ouverts" value={u.rooms_open} />
            <Stat label="Événements stockés" value={u.events_total.toLocaleString("fr-FR")} />
          </div>
          {u.daily.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-fog">
                  <th className="py-1 font-normal">Jour</th>
                  <th className="py-1 text-right font-normal">Appels</th>
                  <th className="py-1 text-right font-normal">Diffusions</th>
                  <th className="py-1 text-right font-normal">Livraisons est.</th>
                </tr>
              </thead>
              <tbody>
                {u.daily.slice(0, 10).map((d) => (
                  <tr key={d.day}>
                    <td className="py-1">{d.day}</td>
                    <td className="num py-1 text-right">{d.rpc_calls}</td>
                    <td className="num py-1 text-right">{d.broadcasts}</td>
                    <td className="num py-1 text-right">{d.delivered_estimate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={busy} onClick={load}>
              Actualiser
            </Button>
            <Button variant="ghost" size="sm" onClick={cleanup}>
              Nettoyer les anciennes données
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const { profile } = useAuth();
  return (
    <AppShell>
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">Réglages</h1>
        <Panel className="space-y-2">
          <SectionTitle>Jeu</SectionTitle>
          <Toggle
            label="Confirmer les déplacements"
            description="Premier toucher : aperçu du trajet. Second toucher : départ."
            checked={s.confirmMoves}
            onChange={(v) => updateSettings({ confirmMoves: v })}
          />
          <Toggle label="Vibrations" description="Captures, alertes et impulsions radar." checked={s.haptics} onChange={(v) => updateSettings({ haptics: v })} />
          <Toggle label="Coordonnées sur la carte" description="Affiche A1, B2… quand le zoom le permet." checked={s.showCoordinates} onChange={(v) => updateSettings({ showCoordinates: v })} />
          <Toggle label="Réduire les animations" checked={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} />
          <Toggle label="Afficher le diagnostic" description="Mesures de connexion et de consommation." checked={s.showDiagnostics} onChange={(v) => updateSettings({ showDiagnostics: v })} />
        </Panel>
        {s.showDiagnostics ? <Diagnostics /> : null}
        {profile?.is_admin ? <AdminUsage /> : null}
        <Panel>
          <SectionTitle>Installer l&apos;application</SectionTitle>
          <p className="text-sm text-fog">
            Sur iPhone : Safari, bouton Partager, puis « Sur l&apos;écran d&apos;accueil ». Sur Android : Chrome, menu ⋮, puis « Installer l&apos;application ». Sur ordinateur : icône d&apos;installation dans la barre d&apos;adresse.
          </p>
        </Panel>
        <Notice>
          {APP_NAME} est un nom provisoire. Positions et déplacements sont entièrement virtuels : aucune géolocalisation n&apos;est utilisée.
        </Notice>
      </div>
    </AppShell>
  );
}
