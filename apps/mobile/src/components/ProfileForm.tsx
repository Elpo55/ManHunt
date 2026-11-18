import { AVATAR_GLYPHS, AVATAR_TINTS, parseAvatar, toAppError } from "@traque/shared";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors, space } from "../theme";
import { Avatar, Button, Field, Input, Notice, T } from "./ui";

export function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved?: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.username ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar ?? `${AVATAR_GLYPHS[0]}:azure`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const { glyph, tint } = parseAvatar(avatar);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.updateProfile(name.trim(), avatar);
      await refreshProfile();
      if (onSaved) onSaved();
      else setMsg({ tone: "info", text: "Profil enregistré." });
    } catch (e) {
      setMsg({ tone: "error", text: toAppError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-end" }}>
        <Avatar avatar={avatar} name={name || "?"} size={56} />
        <View style={{ flex: 1 }}>
          <Field label="Pseudo" hint="2 à 20 caractères, visible par les joueurs de vos salons.">
            <Input value={name} onChangeText={setName} maxLength={20} autoCapitalize="words" placeholder="Ex. Nyx" />
          </Field>
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <T v="caption" color={colors.ivory}>Couleur</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {Object.entries(AVATAR_TINTS).map(([t, c]) => (
            <Pressable
              key={t}
              accessibilityRole="radio"
              accessibilityState={{ checked: t === tint }}
              accessibilityLabel={`Couleur ${t}`}
              onPress={() => setAvatar(`${glyph}:${t}`)}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c, borderWidth: t === tint ? 3 : 0, borderColor: colors.ivory }}
            />
          ))}
        </View>
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label={submitLabel} onPress={save} loading={busy} disabled={name.trim().length < 2} />
    </View>
  );
}
