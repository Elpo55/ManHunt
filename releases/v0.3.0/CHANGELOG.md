# Projet Traque — v0.3.0 (build 300)

Stabilisation après audit complet, premier APK Android livré (`releases/v0.3.0/`). Build Android : 300.

### Corrigé
- **[P0] Confidentialité** : après une partie, tout participant pouvait lire pendant 30 jours les événements de position (arrondies) de tous les joueurs, y compris de l'équipe adverse. Migration `0900` : ces événements ne sont plus lisibles hors de son équipe après la partie, sont effacés 24 h après la fin (comme les positions brutes), et l'arrêt de sécurité / quitter la partie les efface aussi.
- **[P0] GPS** : un arrêt du suivi pendant son démarrage (fin de partie, changement d'écran rapide) pouvait laisser l'abonnement GPS actif après la partie, ou effacer la partie mémorisée d'un nouveau démarrage. Démarrages/arrêts désormais sérialisés.
- **[P0] Connexion** : un échec réseau au chargement du profil laissait l'application sur « Chargement » indéfiniment. Nouvel écran d'erreur avec « Réessayer » et « Se déconnecter » ; nouvelles tentatives automatiques.
- **[P1] Menus Android tronqués** : `Alert` n'affiche que 3 boutons sur Android. L'hôte ne voyait pas « Exclure » / « Transmettre le rôle d'hôte » dans le lobby, ni toutes les options du menu de partie. Remplacés par une feuille d'actions.
- **[P1] Bouton retour Android en partie** : quittait l'écran de jeu sans prévenir et coupait le partage GPS. Il ouvre désormais le menu de la partie (ou ferme le panneau).
- **[P1] Envoi des positions en rafale** : iOS ignore l'intervalle GPS demandé et les flux premier plan / arrière-plan se cumulent ; le serveur refusait alors des positions (« Position refusée »). Envoi limité à un par intervalle de la partie, la plus récente seulement.
- **[P2] Code d'invitation perdu** : « J'ai un code de salon » ou un lien `traque://join?code=…` ouvert sans être connecté ramenait à l'accueil après connexion. La destination est conservée (connexion → profil → autorisations → salon).
- **[P2] Carte** : propriétés natives recréées toutes les 500 ms (bornes, couches) ; rafraîchissement limité à 1 Hz et valeurs mémorisées. Les boutons de carte ne chevauchent plus le panneau Joueurs/Radar/Journal.
- **[P2] Fin de partie sans vainqueur** : affichage « Égalité » robuste (plus de « Victoire des undefined » possible).
- Avertissements de lint résolus.

### Ajouté
- Message « Fond de carte indisponible » si les tuiles ne se chargent pas (le jeu reste utilisable).
- Option « Sans équipe » dans le menu joueur de l'hôte.
- Version et numéro de build affichés dans Réglages (lus dans l'application installée).
- `npm run release:apk` : vérifications, APK release, contrôles (version, signature, configuration intégrée, absence de secret), dossier `releases/vX.Y.Z/` avec changelog et rapport de build.
- Tests de non-régression : confidentialité des événements (3), limitation d'envoi GPS, destination après connexion (3).

### Modifié
- Version : source unique `apps/mobile/package.json` ; numéro de build dérivé (`MAJEUR*10000 + MINEUR*100 + CORRECTIF`) ; `eas.json` en version locale (les builds EAS et locaux portent le même numéro).
- Dépendance ajoutée : `expo-application`.
