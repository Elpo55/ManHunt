import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Guard } from "../components/Guard";
import { ProfileForm } from "../components/ProfileForm";
import { Panel, Screen, T } from "../components/ui";
import { safeNext, withNext } from "@traque/shared";

export default function Onboarding() {
  const router = useRouter();
  const next = safeNext(useLocalSearchParams<{ next?: string }>().next);
  return (
    <Guard requireProfile={false}>
      <Screen>
        <Stack.Screen options={{ title: "Votre profil" }} />
        <T v="small">Choisissez un pseudo. Vous pourrez le changer à tout moment.</T>
        <Panel>
          <ProfileForm submitLabel="Continuer" onSaved={() => router.replace(withNext("/permissions", next))} />
        </Panel>
      </Screen>
    </Guard>
  );
}
