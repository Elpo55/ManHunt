# Guide de tests

Trois niveaux, clairement distincts :

| Niveau | Outil | Besoin d'un projet Supabase ? | État |
|--------|-------|-------------------------------|------|
| Tests automatisés unitaires | Vitest | non | ✅ exécutés |
| Tests automatisés base de données (intégration, sécurité, simulation 20 joueurs) | Vitest + PGlite (PostgreSQL réel en WASM) | non | ✅ exécutés |
| Test de charge réseau réel (20 clients Realtime) | `scripts/load-test.mjs` | **oui** | ⏳ à lancer par vous |
| Tests manuels multi-téléphones | procédure ci-dessous | **oui** + déploiement | ⏳ à faire par vous |

---

## 1. Lancer les tests automatisés

```bash
npm install
npm test              # tout : 87 tests
npm run test:unit     # moteur client (grille, chemins, radar, états, séquenceur, horloge, contrôleur)
npm run test:db       # PostgreSQL : salons, moteur de jeu, RLS, Realtime, cron, simulation
npm run typecheck
npm run lint
npm run build         # vérifie l'export statique
```

### Ce que couvrent les tests base de données

Les migrations réelles sont appliquées à un PostgreSQL embarqué, avec des substituts minimaux de Supabase (`tests/db/supabase-stubs.sql` : rôles `anon`/`authenticated`, `auth.uid()`, `realtime.send`, `realtime.messages`). Les requêtes s'exécutent sous le rôle `authenticated` avec l'identité du joueur : **la RLS s'applique réellement**. L'horloge serveur est pilotée (`db.advance(ms)`).

- `rooms.test.ts` : profils, création/rejoindre/quitter, salon plein, codes invalides, force brute (limitation), équipes, répartition auto, exclusion/bannissement, transfert d'hôte (départ et inactivité), conditions de démarrage, configurations sauvegardées.
- `game.test.ts` : génération de carte (connexité, déterminisme), apparition, préparation, déplacements (chemin, obstacles, pas, régénération), visibilité, captures, victoire/égalité/abandon, déconnexion et délai de grâce, pause/reprise, radar (synchronisation, doublons, rattrapage, précisions, brouillage, manuel), capacités, mode Infection + rotation de topic, resynchronisation.
- `security.test.ts` : isolation des équipes (tables, colonnes, journal), écritures interdites, fonctions privées, rôle anonyme, autorisation des topics Realtime, interdiction de diffuser, absence de fuite de positions, contiguïté des séquences.
- `simulation.test.ts` : **20 joueurs** (6 Chasseurs, 14 Fugitifs), 240 secondes de jeu, ~1 200 actions concurrentes ; vérifie les invariants (positions valides, pas ≥ 0, séquences contiguës, uniquement des refus réglementaires) et mesure les messages.
- `config-parity.test.ts` : la normalisation de configuration TS et SQL produit exactement le même résultat.
- `cron.test.ts` : le script optionnel pg_cron fait avancer les parties sans client.

> La simulation mesure la **cohérence du moteur sous charge**, pas la latence réseau. La latence réelle se mesure avec le test de charge ci-dessous.

## 2. Simuler 20 joueurs réels (test de charge)

Prérequis : projet Supabase configuré, `.env.local` rempli, invités anonymes activés.

```bash
npm run test:load                                   # 20 joueurs, 120 s
node scripts/load-test.mjs --players 20 --duration 180 --hunters 6
```

Le script crée 20 sessions invitées (mises en cache dans `.load-test-sessions.json`, ignoré par Git, pour respecter la limite de 30 inscriptions anonymes/heure/IP), un salon, lance une partie (radar toutes les 15 s), abonne chaque joueur à ses 3 canaux privés, joue des actions, coupe puis rétablit le Realtime de 3 joueurs à mi-parcours, puis interrompt la partie.

Résultats affichés : abonnements réussis/échoués, messages reçus, **latence serveur → client** (p50/p95/max), trous/doublons de séquence, impulsions radar reçues, reconnexions, latence RPC, erreurs par code.

Critères d'acceptation suggérés : 0 échec d'abonnement, latence p95 < 500 ms, 0 erreur `E_INTERNAL`, 3/3 reconnexions cohérentes, ≈ (durée / 15) × 6 impulsions radar reçues.

⚠️ Consomme du quota Realtime (quelques dizaines de milliers de messages). Le premier lancement crée 20 profils « ChargeXX » : vous pouvez les supprimer ensuite dans **Authentication → Users**.

## 3. Tester les connexions et la synchronisation (manuel, 2 appareils)

1. Appareil A : créer un salon. Appareil B : rejoindre par lien.
2. Vérifier : B apparaît chez A avec un point vert en moins d'une seconde ; « En direct » des deux côtés.
3. A change l'équipe de B → mise à jour immédiate chez B.
4. Activez **Réglages → Afficher le diagnostic** : les compteurs « Messages temps réel reçus » augmentent.

## 4. Tester le radar

1. Règles : radar **Automatique**, intervalle **15 s**, précision **Secteur**, équipes **Chasseurs**.
2. Lancer une partie avec préparation 15 s.
3. Côté Chasseur : le panneau Radar annonce « prochaine impulsion dans 00:15 » ; à 0, balayage sonar sur la carte, rectangles pointillés sur les secteurs, ligne dans le journal, vibration.
4. Côté Fugitif : notification « Impulsion radar adverse détectée » au même moment.
5. Fugitif active **Brouilleur** → à l'impulsion suivante, un contact « Signal brouillé ».
6. Variante **Manuel** : bouton Radar avec recharge ; deux appuis rapides → le second est refusé (« En recharge »).
7. Les comptes à rebours doivent être identiques sur les deux téléphones (à ±1 s), même si l'heure d'un téléphone est volontairement décalée dans ses réglages (le chrono suit l'horloge serveur).

## 5. Tester les déconnexions

1. Pendant une partie, passez un téléphone en **mode avion** 20 s puis réactivez : badge « Hors ligne » puis « Reconnexion… » puis « En direct » ; l'état (position, journal, chrono) est resynchronisé.
2. Mode avion **plus de 45 s** : les autres voient l'icône « déconnecté » à côté du joueur.
3. Mode avion **plus que le délai d'abandon** (réglage hôte, défaut 120 s) : le joueur passe « abandon » ; si c'était le dernier de son équipe, la partie se termine.
4. Fermer complètement l'application puis la rouvrir via l'accueil → « Vos salons » → partie en cours : retour direct dans la partie.
5. L'hôte quitte le salon : le rôle passe au joueur présent depuis le plus longtemps (couronne).

## 6. Vérifier la synchronisation

- Deux Chasseurs côte à côte : le déplacement de l'un apparaît chez l'autre immédiatement (trace bleue).
- Un Fugitif entre dans la vision d'un Chasseur : il apparaît chez **tous** les Chasseurs ; il disparaît s'il sort de la vision ou active Fantôme.
- Un Fugitif voit tous ses coéquipiers, mais ne voit les Chasseurs que lorsqu'ils sont dans le rayon de vision de son équipe (et inversement).
- Après la partie, la page Résultats montre toutes les positions et les trajets complets.

## 7. Partie réelle avec plusieurs téléphones (procédure)

Matériel : 4 à 20 téléphones (Android et iPhone mélangés si possible), connectés à Internet (Wi-Fi ou données mobiles, pas besoin du même réseau).

1. **Préparation (hôte)** : application déployée, compte administrateur créé. Installez la PWA sur votre téléphone.
2. **Créer le salon** : Accueil → Créer un salon → préréglage « Éclair » (6 min) pour un premier test.
3. **Inviter** : bouton « Partager le lien » → envoyez-le dans votre groupe de discussion.
4. **Chaque joueur** : ouvre le lien → Jouer en invité → pseudo → arrive dans le lobby.
5. **Équipes** : « Répartir au hasard » (≈ 1 Chasseur pour 2–3 Fugitifs), vérifier que chacun voit sa couleur.
6. **Lancer**. Pendant la préparation, les Fugitifs se cachent ; les Chasseurs voient « Vous partirez au signal ».
7. **Jouer** jusqu'au bout. Pendant la partie, testez au moins une fois : pause/reprise (hôte), une capture, chaque capacité, un téléphone en mode avion 30 s.
8. **Résultats** : chacun ouvre la page Résultats ; vérifiez que les scores sont identiques sur tous les appareils.
9. **Retour au salon → Nouvelle partie** pour enchaîner.

Fiche de relevé (à remplir pendant le test) :

| Vérification | OK / KO | Remarque |
|--------------|---------|----------|
| Tous les joueurs ont rejoint par le lien | | |
| Présence en ligne exacte dans le lobby | | |
| Chrono identique sur tous les téléphones | | |
| Impulsions radar simultanées | | |
| Captures prises en compte immédiatement | | |
| Reconnexion après mode avion | | |
| Aucune information adverse visible hors règles | | |
| Résultats identiques partout | | |
| Interface utilisable sans zoom sur le plus petit écran | | |

Ces tests manuels **n'ont pas été réalisés** pendant le développement (aucun projet Supabase ni appareil disponible).

## 8. Aperçu visuel sans serveur (développement)

`npm run dev` puis http://localhost:3000/dev/preview/ : écran de jeu rempli de **données fictives**, pour travailler l'interface sans backend. Cette page est désactivée dans le build de production.
