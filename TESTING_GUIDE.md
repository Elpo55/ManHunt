# Guide de tests

| Niveau | Outil | Projet Supabase ? | Appareil ? | État |
|--------|-------|-------------------|-----------|------|
| Unitaires (logique partagée) | Vitest | non | non | ✅ exécutés (27) |
| Base de données (intégration, sécurité, GPS, confidentialité, simulation 20 joueurs) | Vitest + PGlite (PostgreSQL réel) | non | non | ✅ exécutés (58) |
| Typage, lint, `expo-doctor`, bundles Metro Android/iOS | tsc, ESLint, Expo | non | non | ✅ exécutés |
| APK release Android + contrôles (version, signature, configuration, secrets) | `npm run release:apk` | non | non | ✅ v0.3.0, v0.3.1 (voir `releases/v*/BUILD_REPORT.md`) — contrôles statiques ; installation sur appareil non réalisée |
| Test de charge réseau réel (20 clients Realtime) | `scripts/load-test.mjs` | **oui** | non | ⏳ à lancer par vous |
| Tests sur téléphones (GPS, arrière-plan, carte) | procédures ci-dessous | **oui** | **oui** | ⏳ à faire par vous — **jamais réalisés à ce jour** |

## 1. Tests automatisés

```bash
npm install
npm test                 # 85 tests
npm run test:unit        # géographie, configuration, état, couches carte, contrôleur, séquenceur, horloge
npm run test:db          # salons, moteur GPS, sécurité, parité TS/SQL, cron, simulation
npm run typecheck        # racine + shared + mobile
npm run lint             # application mobile
cd apps/mobile && npx expo-doctor && npx expo export --platform android
```

Couverture des tests base de données (PostgreSQL réel, rôles et RLS appliqués) :
- **game.test.ts** : zone et consentement obligatoires ; aucune position initiale ; validation des positions (bornes, horodatage, ordre, **vitesse implausible**, distance) ; refus sans consentement / après la fin ; diffusion ~10 m aux coéquipiers et approximative + limitée aux adversaires ; précision jamais supérieure au GPS ; Fugitifs invisibles en préparation ; sortie de zone et élimination ; capture refusée hors zone ; captures par distance réelle (précision, fraîcheur, recharge, victoire) ; Infection et rotation du canal ; radar direction/distance, brouillage, signal perdu, secteur, zone, mode « impulsions » ; Fantôme, Leurre, Brouilleur, Scan, Traqueur, Sonar ; **arrêt de sécurité** (sortie + effacement) ; **rétention 24 h** ; vue de partie sans coordonnées adverses exactes ; pause ; fin du temps ; abandon.
- **security.test.ts** : positions brutes inaccessibles à tous les clients, isolation des équipes, colonnes techniques, journal filtré, aucune écriture directe, fonctions privées inaccessibles, rôle anonyme, non-participant, autorisations des canaux Realtime, interdiction de diffuser, **aucune coordonnée brute dans aucun flux**, séquences contiguës.
- **simulation.test.ts** : 20 joueurs marchant ~1,5 m/s pendant 6 min, envoi toutes les 5 s, poursuites et captures ; invariants et volume Realtime (~32 messages/s).
- **privacy-events.test.ts** (v0.3.0) : après la partie, aucun événement de position de l'équipe adverse lisible ; effacement des événements de position 24 h après la fin ; arrêt de sécurité = effacement des événements de position du joueur.
- **rooms.test.ts** : profils, salons, codes, force brute, équipes, hôte, exclusion, conditions de lancement.

## 1 bis. Vérifier un APK livré (à chaque version)

Installez `releases/vX.Y.Z/application-vX.Y.Z.apk` (DEPLOYMENT_GUIDE §0), puis :
1. **Réglages** → « Version X.Y.Z (build N) » identique au dossier et au BUILD_REPORT.
2. **Commencer → Jouer en invité** → pseudo → écran Localisation → Continuer → tableau de bord (pas de « Serveur non configuré »).
3. **Mode avion** puis relance de l'application : écran « Connexion au serveur impossible » avec **Réessayer** (jamais de chargement infini) ; réseau rétabli → Réessayer fonctionne.
4. Avec un second appareil : créer un salon, **Inviter** → le lien/code ; sur l'autre, déconnecté, ouvrir le lien `traque://join?code=…` → après connexion et pseudo, le salon s'ouvre directement.
5. Lobby (hôte) : toucher un joueur → menu avec **Chasseur / Fugitif / Sans équipe / Transmettre le rôle d'hôte / Exclure** (5 actions visibles sur Android).
6. En partie : **bouton retour Android** → ouvre le menu de la partie (ne quitte pas l'écran) ; menu hôte : Pause / Terminer / Retour au salon / Fermer.
7. En partie, badge GPS « Partagée · ±x m » stable (pas de « Position refusée par le serveur » en marchant normalement).
8. Fin de partie → **Résultats** → **Retour au salon** → **Nouvelle partie** ; vérifier que la notification « Partage de position actif » a disparu.

Notez pour chaque point : OK / KO + modèle du téléphone + version d'Android.

## 2. Simuler 20 joueurs réels (charge réseau)

Prérequis : projet Supabase configuré, `apps/mobile/.env` rempli, mode invité activé.
```bash
npm run test:load
node scripts/load-test.mjs --players 20 --duration 180 --hunters 6
```
Le script crée 20 sessions invitées (cache `.load-test-sessions.json`), un salon, une zone de test **simulée** (aucune vraie position), les consentements, lance la partie, envoie des positions simulées toutes les ~5 s, tente des captures, coupe/rétablit le Realtime de 3 joueurs et mesure : abonnements, messages, latence serveur→client, trous de séquence, impulsions radar, reconnexions, latence RPC, erreurs.
Critères suggérés : 0 échec d'abonnement, latence p95 < 500 ms, aucune erreur `E_INTERNAL`, reconnexions 3/3.

## 3. Tests sur un téléphone (seul)

Préalable : *development build* installée (DEPLOYMENT_GUIDE §1).
1. **Autorisations** : premier lancement → écran Localisation ; refuser puis accepter ; vérifier que l'état se met à jour au retour des Réglages. Désactiver « Position exacte » → l'avertissement apparaît.
2. **Zone** : créer un salon, chercher « parc » d'une ville, choisir un résultat, déplacer la carte, régler le rayon.
3. **Consentement** : sans accepter les consignes, le bouton Lancer reste bloqué (message explicite).
4. **GPS premier plan** (avec un second compte sur un autre téléphone ou un émulateur) : lancer, marcher 50 m ; le badge affiche « Partagée · ±x m » ; la position se met à jour.

## 4. Tester les déconnexions et l'arrière-plan

| Scénario | Attendu |
|----------|---------|
| Mode avion 20 s | badge « Hors ligne », puis retour à « Partagée » ; les autres voient la position « obsolète » puis à jour |
| Mode avion > 45 s | les autres voient « déconnecté » |
| Mode avion > délai d'abandon (défaut 180 s) | joueur « a quitté » ; victoire si dernier de son équipe |
| Écran éteint 2 min (autorisation « Toujours » accordée) | Android : notification « Partage de position actif » ; la position continue d'être mise à jour chez les autres (iOS : mises à jour possiblement espacées) |
| Écran éteint, autorisation « Toujours » refusée | bandeau d'avertissement dans le jeu ; la position devient obsolète ; reprise au retour dans l'application |
| Application fermée (balayée) | le suivi s'arrête (comportement normal, documenté) ; à la réouverture, retour à la partie |
| Bouton **Arrêt** | confirmation → sortie immédiate, notification Android disparue, les autres voient « a arrêté le partage » |
| Fin de partie | le partage s'arrête seul (notification disparue, badge « Partage arrêté ») |

Note : sur certains Android (Xiaomi, Huawei, Samsung…), désactivez l'optimisation de batterie pour l'application ([dontkillmyapp.com](https://dontkillmyapp.com)).

## 5. Tester le radar et les captures (2 téléphones minimum)

1. Règles : radar automatique toutes les 30 s (`interval_s` minimum), précision « Direction ».
2. À l'impulsion : anneau sur la carte côté Chasseur, cap pointillé vers le Fugitif, « Radar : Nord-Est, ~150 m » dans le journal ; côté Fugitif : « Impulsion radar adverse détectée ».
3. Fugitif active **Brouilleur** → impulsion suivante : « Signal brouillé ».
4. Capture : rapprochez-vous à moins de 15 m (marcher, ne pas courir) ; « Capturer » réussit si les deux précisions GPS sont ≤ 35 m. À 40 m : « Aucun Fugitif assez proche ».

## 6. Vérifier la synchronisation

- Chronos identiques (± 1 s) sur tous les téléphones, même si l'heure d'un téléphone est volontairement décalée.
- Coéquipiers mis à jour toutes les ~5 s ; adversaires toutes les ~15 s (ou à chaque impulsion en mode « par impulsions »).
- Panneau Joueurs : « il y a N s » cohérent ; au-delà de 45 s, « obsolète » et marqueur grisé.

## 7. Partie réelle avec plusieurs téléphones (procédure)

Lieu : **parc ou espace public piéton**, à l'écart de la circulation. Groupe : 4 à 20 personnes, Android et iPhone mélangés si possible.
1. Hôte : choisir la zone (rayon 300–500 m pour un premier test), préréglage « Quartier », partager le code.
2. Chacun : installer l'application, rejoindre, choisir son équipe, **lire et accepter les consignes**.
3. Lancer ; préparation 90 s (Fugitifs se dispersent).
4. Jouer jusqu'au bout ; tester au moins : une pause/reprise, une capture, une capacité par équipe, un mode avion de 30 s, un **Arrêt** volontaire.
5. Comparer les écrans Résultats sur plusieurs téléphones.

Fiche de relevé :
| Vérification | OK/KO | Remarques (modèle de téléphone, OS) |
|--------------|-------|-------------------------------------|
| Installation et autorisations | | |
| Précision GPS affichée (± m) | | |
| Positions coéquipiers fluides | | |
| Positions adverses approximatives et datées | | |
| Positions obsolètes signalées | | |
| Radar simultané et cohérent | | |
| Captures à < 15 m acceptées | | |
| Écran éteint : partage maintenu (Android / iOS) | | |
| Arrêt de sécurité immédiat | | |
| Fin de partie : partage arrêté | | |
| Consommation batterie (% / 30 min) | | |
| Résultats identiques | | |
