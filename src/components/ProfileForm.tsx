"use client";
import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { useAuth } from "./providers/AuthProvider";
import { Avatar, Button, Field, Input, Notice, cx } from "./ui/primitives";
import { AVATAR_GLYPHS, AVATAR_TINTS, parseAvatar, randomAvatar } from "@/lib/avatars";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";

export function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved?: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.username ?? "");
  const [avatar, setAvatar] = useState(profile?.username ? profile.avatar : randomAvatar());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { glyph, tint } = parseAvatar(avatar);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProfile(name.trim(), avatar);
      await refreshProfile();
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar avatar={avatar} size={64} />
        <div className="min-w-0 flex-1">
          <Field label="Pseudo" htmlFor="username" hint="Visible par les joueurs de vos salons.">
            <Input
              id="username"
              required
              minLength={2}
              maxLength={20}
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Nyx"
            />
          </Field>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Emblème</legend>
        <div className="grid grid-cols-8 gap-2">
          {AVATAR_GLYPHS.map((g) => (
            <button
              type="button"
              key={g}
              aria-label={`Emblème ${g}`}
              aria-pressed={g === glyph}
              onClick={() => setAvatar(`${g}:${tint}`)}
              className={cx("flex aspect-square items-center justify-center rounded-[10px]", g === glyph ? "bg-slate-2 ring-1 ring-volt" : "bg-slate")}
            >
              <Avatar avatar={`${g}:${tint}`} size={30} className="bg-transparent" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Teinte</legend>
        <div className="grid grid-cols-8 gap-2">
          {Object.entries(AVATAR_TINTS).map(([t, color]) => (
            <button
              type="button"
              key={t}
              aria-label={`Teinte ${t}`}
              aria-pressed={t === tint}
              onClick={() => setAvatar(`${glyph}:${t}`)}
              className={cx("flex aspect-square items-center justify-center rounded-full", t === tint && "ring-2 ring-ivory ring-offset-2 ring-offset-graphite")}
              style={{ background: color }}
            >
              {t === tint ? <Check className="size-4 text-abyss" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </fieldset>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved && !onSaved ? <Notice>Profil enregistré.</Notice> : null}
      <Button type="submit" size="lg" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
