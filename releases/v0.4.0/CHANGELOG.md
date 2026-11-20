# Manhunt — v0.4.0 (build 400)

Grande mise à jour fonctionnelle : administration, nouveaux modes, capture QR, objectifs, sécurité, communication d'équipe, distribution hors store, préparation iOS. Build Android : 400. Nom affiché : **Manhunt**.

### Ajouté — administration (migration `1000`)
- Rôles serveur : propriétaire > administrateur > modérateur > joueur (l'hôte reste propre à chaque salon). Seul le propriétaire attribue les rôles.
- Tableau de bord intégré (Réglages → Administration) : activité (inscrits, connectés, parties, salons), état du backend (base, temps réel, tâches pg_cron), erreurs remontées par l'application, quotas, nettoyage.
- Joueurs : recherche, fiche (statistiques, parties, sanctions), avertissement, suspension temporaire (modérateur : 72 h max), levée de sanction. Un compte suspendu ne peut plus créer ni rejoindre de salon.
- Parties et salons : participants, équipes, paramètres résumés (sans aucune coordonnée), pause / reprise / terminaison d'une partie bloquée (non comptée), fermeture de salon.
- Signalements : envoi par les joueurs (lobby, partie), notes internes, clôture avec décision, historique.
- Paramètres globaux : limite de joueurs (appliquée par le serveur), valeurs par défaut, activation des fonctionnalités, distance d'alerte de proximité, annonce sur l'accueil, publication de versions.
- Journal d'audit (auteur, rôle, action, cible, motif, résultat). Motif obligatoire pour toute action.
- Protection du gameplay : aucune fonction d'administration ne lit de position, ne capture, ne déplace ni ne modifie un résultat ; toute intervention en partie est annoncée à tous les joueurs.

### Ajouté — modes et gameplay (migration `1010`)
- **Royale** jouable : zone réduite par étapes (calcul serveur, déterministe), prochain cercle annoncé, avertissement avant réduction, élimination des Fugitifs restés dehors.
- **Mister X** jouable : un seul Fugitif, jamais diffusé en direct, position exacte révélée aux Chasseurs à intervalle régulier (et lui est prévenu).
- **Capture par QR code** : QR temporaire (45 s, usage unique) affiché par le Fugitif, scanné par le Chasseur ; code à 6 caractères si la caméra est indisponible ; contrôle de distance si les positions sont récentes. Méthode configurable : GPS, QR ou les deux.
- **Objectifs** : balises placées par l'hôte (points, victoire optionnelle si toutes prises) et point d'extraction ouvert en fin de partie (Fugitif mis à l'abri + bonus).
- **Zones** : zone polygonale, zones interdites (dans la zone = hors zone), validation serveur.
- **Spectateurs** : un joueur capturé suit la partie avec des positions différées (3 min par défaut) ; il perd l'accès au canal privé de son équipe (rotation des canaux à chaque capture) et ne peut plus communiquer.
- **GPS muet** : détecté côté serveur et signalé à tous (jamais traité comme de la triche), distinct d'une perte de réseau.

### Ajouté — sécurité, équipe, confort (migration `1020`)
- **SOS** : pause immédiate, alerte à tous, message, position exacte seulement si le joueur l'accepte, reprise impossible avant levée, rappel d'appeler le 112.
- **Heure de fin et point de rendez-vous** affichés en permanence.
- **Messages rapides** d'équipe (12 messages prédéfinis, anti-spam) et **repères sur la carte** (appui long, 3 min, invisibles de l'adversaire).
- **Batterie et état des coéquipiers** (API officielle du système, « inconnue » sinon), application en arrière-plan, GPS.
- **Notifications locales** en arrière-plan / écran éteint (catégories réglables, anti-répétition) et alertes de proximité (Chasseur proche, Fugitif détecté).
- **Configurations sauvegardées** : enregistrer, charger, renommer, dupliquer, supprimer.
- **Cartes hors ligne** : téléchargement du fond de carte d'une zone (zooms 12–16, 4 000 tuiles max), suppression.
- **Replay 24 h** : trajets reconstruits (arrondis à 10 m), lecture, chronologie, événements ; réservé aux participants.
- **Succès** (13, déblocage serveur) et **statistiques par mode**, séries de victoires.
- **Alerte de nouvelle version** (facultative / recommandée / importante, notes, lien) et préparation d'**EAS Update** (inactif tant que le projet n'est pas relié à expo.dev).

### Corrigé
- **Pause** : la durée du Leurre n'était pas prolongée et le délai « hors zone » continuait de courir pendant une pause.
- **Normalisation serveur** : des points sans longitude pouvaient être acceptés (test `jsonb_typeof` NULL) — trouvé par le test de parité.
- **iOS** : l'autorisation « Push » ajoutée par le module de notifications empêchait la signature avec un compte Apple gratuit ; retirée (notifications locales seulement).
- **Spectateurs** : un joueur capturé restait abonné au canal privé de son équipe.

### Modifié
- Nom affiché : Manhunt. APK livré sous le nom `Manhunt-vX.Y.Z.apk`.
- Nouveaux modules natifs : expo-camera, expo-notifications (local), expo-battery, expo-updates ; bibliothèque JavaScript qrcode-generator.
- `heartbeat` accepte l'état de l'appareil (compatible avec les versions 0.3.x).

### Tests
- 103 tests automatisés (30 unitaires, 73 PostgreSQL réel dont 15 nouveaux pour la v0.4.0), typage, lint, expo-doctor, bundle iOS.
