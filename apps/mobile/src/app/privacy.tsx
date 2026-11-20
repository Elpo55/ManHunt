/** Confidentialité : données traitées, qui y accède, durées de conservation, droits (RGPD). */
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { Button, Panel, Screen, SectionTitle, T } from "../components/ui";
import { APP_NAME } from "../lib/env";
import { colors, space } from "../theme";

const Row = ({ title, text }: { title: string; text: string }) => (
  <View style={{ gap: 2 }}>
    <T color={colors.ivory}>{title}</T>
    <T v="small">{text}</T>
  </View>
);

export default function Privacy() {
  const router = useRouter();
  return (
    <Screen>
      <Stack.Screen options={{ title: "Confidentialité" }} />
      <T v="small">{`${APP_NAME} est un jeu privé entre amis. Voici exactement ce qui est enregistré, pourquoi, qui peut le voir et combien de temps.`}</T>
      <Panel>
        <SectionTitle>Données enregistrées</SectionTitle>
        <Row title="Compte" text="Pseudo et avatar. Pour un compte e-mail : adresse e-mail (confirmée par un code) et mot de passe chiffré, que personne ne peut lire. Un compte invité n'a aucune adresse." />
        <Row title="Jeu" text="Salons, équipes, résultats, statistiques, succès, signalements et sanctions éventuels." />
        <Row title="Position GPS" text="Uniquement pendant une partie, après votre accord dans le salon. Arrondie avant d'être montrée aux autres joueurs." />
        <Row title="Appareil" text="Pendant une partie : niveau de batterie et état du GPS, visibles par vos coéquipiers seulement." />
        <Row title="Diagnostic" text="Erreurs inattendues de l'application (sans position), pour corriger les bugs." />
      </Panel>
      <Panel>
        <SectionTitle>Qui voit quoi</SectionTitle>
        <Row title="Les autres joueurs" text="Votre pseudo, avatar, équipe, statistiques publiques ; pendant une partie, votre position arrondie selon les règles du salon." />
        <Row title="L'administration du jeu" text="Pseudo, type de compte, dates d'inscription et d'activité, statistiques, parties, sanctions et signalements. L'e-mail est masqué ; son affichage complet est réservé au support, motivé et enregistré dans un journal. L'administration ne voit jamais votre mot de passe ni vos positions." />
        <Row title="Corrections" text="Si le propriétaire du jeu corrige vos statistiques ou vos succès, vous en êtes informé dans votre profil." />
      </Panel>
      <Panel>
        <SectionTitle>Durées de conservation</SectionTitle>
        <Row title="Positions et trajets (replay)" text="Effacés 24 h après la fin de la partie, ou immédiatement si vous utilisez le bouton Arrêt." />
        <Row title="Événements de partie" text="30 jours." />
        <Row title="Erreurs de diagnostic" text="14 jours." />
        <Row title="Compte et statistiques" text="Tant que vous gardez votre compte." />
      </Panel>
      <Panel>
        <SectionTitle>Vos droits</SectionTitle>
        <T v="small">
          Vous pouvez à tout moment modifier votre pseudo, retirer l’autorisation de localisation dans les réglages du téléphone, arrêter le partage en partie, et supprimer définitivement votre compte et toutes vos données depuis votre profil. Pour toute autre demande (accès, rectification), adressez-vous à l’organisateur du jeu.
        </T>
        <Button label="Aller à mon profil" small variant="secondary" onPress={() => router.push("/profile")} style={{ marginTop: space.sm }} />
      </Panel>
    </Screen>
  );
}
