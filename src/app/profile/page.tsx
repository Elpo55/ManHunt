"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BarChart3, LogOut } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProfileForm } from "@/components/ProfileForm";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, ButtonLink, Field, Input, Notice, Panel, SectionTitle, Stat } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { formatDuration } from "@/lib/engine/rules";

function LinkEmail() {
  const { linkEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await linkEmail(email.trim(), password);
      setMsg({ tone: "info", text: "Vérifiez votre boîte mail : confirmez l'adresse pour finaliser votre compte." });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SectionTitle>Conserver ce profil</SectionTitle>
      <p className="mb-4 text-sm text-fog">
        Vous jouez en invité : si vous effacez les données du navigateur, ce profil sera perdu. Liez un e-mail pour le retrouver sur n&apos;importe quel appareil.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail" htmlFor="link-email">
          <Input id="link-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mot de passe" htmlFor="link-pass" hint="8 caractères minimum.">
          <Input id="link-pass" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button type="submit" variant="secondary" block loading={busy}>
          Lier cet e-mail
        </Button>
      </form>
    </Panel>
  );
}

export default function ProfilePage() {
  const { profile, session, signOut } = useAuth();
  const router = useRouter();
  const [confirmOut, setConfirmOut] = useState(false);
  const p = profile;

  return (
    <AppShell>
      {p ? (
        <div className="space-y-5">
          <h1 className="text-2xl font-semibold">Profil</h1>
          <Panel>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Parties" value={p.games_played} />
              <Stat label="Victoires" value={p.wins} sub={p.games_played ? `${Math.round((100 * p.wins) / p.games_played)} %` : undefined} />
              <Stat label="Captures" value={p.captures} />
              <Stat label="Survie cumulée" value={formatDuration(p.survival_seconds)} />
            </div>
            <ButtonLink href="/stats/" variant="ghost" size="sm" className="mt-4 -ml-2" icon={<BarChart3 className="size-4" />}>
              Voir l&apos;historique et les statistiques
            </ButtonLink>
          </Panel>
          <Panel>
            <SectionTitle>Identité</SectionTitle>
            <ProfileForm submitLabel="Enregistrer" />
          </Panel>
          {p.is_guest ? <LinkEmail /> : (
            <Panel>
              <SectionTitle>Compte</SectionTitle>
              <p className="text-sm text-fog">Connecté avec {session?.user.email}</p>
            </Panel>
          )}
          <Button variant="danger" block icon={<LogOut className="size-4" />} onClick={() => setConfirmOut(true)}>
            Se déconnecter
          </Button>
          <Dialog
            open={confirmOut}
            onOpenChange={setConfirmOut}
            title="Se déconnecter ?"
            description={p.is_guest ? "Profil invité : sans e-mail lié, vous ne pourrez plus le récupérer." : "Vous pourrez vous reconnecter avec votre e-mail."}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirmOut(false)}>
                  Annuler
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await signOut();
                    router.replace("/");
                  }}
                >
                  Se déconnecter
                </Button>
              </>
            }
          />
        </div>
      ) : null}
    </AppShell>
  );
}
