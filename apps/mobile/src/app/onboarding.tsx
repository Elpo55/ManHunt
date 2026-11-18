import { Stack, useRouter } from "expo-router";
import { Guard } from "../components/Guard";
import { ProfileForm } from "../components/ProfileForm";
import { Panel, Screen, T } from "../components/ui";

export default function Onboarding() {
  const router = useRouter();
  return (
    <Guard requireProfile={false}>
      <Screen>
        <Stack.Screen options={{ title: "Votre profil" }} />
        <T v="small">Choisissez un pseudo. Vous pourrez le changer à tout moment.</T>
        <Panel>
          <ProfileForm submitLabel="Continuer" onSaved={() => router.replace("/permissions")} />
        </Panel>
      </Screen>
    </Guard>
  );
}
