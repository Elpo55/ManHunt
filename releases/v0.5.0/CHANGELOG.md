# Manhunt — v0.5.0 (build 500)

Comptes e-mail vérifiés par code, correction des statistiques par le propriétaire, confidentialité (RGPD). Build Android : 500.

### Ajouté
- **Code à 6 chiffres par e-mail** à la création d'un compte (le compte n'est actif qu'après saisie du code, renvoi possible après 60 s, code valable 15 min). Connexion ensuite par mot de passe ; un compte jamais confirmé redemande un code.
- **Mot de passe oublié** : code par e-mail puis nouveau mot de passe.
- **Invité → compte e-mail** : l'adresse liée est confirmée par code.
- E-mails envoyés en français depuis un compte Gmail dédié (SMTP configuré sur Supabase, 30 e-mails/h).
- **Administration — correction des statistiques et des succès** (propriétaire uniquement) : valeurs contrôlées (entiers ≥ 0, cohérence parties/victoires/séries), motif obligatoire, journal avant/après, avis affiché au joueur dans son profil ; historique des corrections dans la fiche joueur (migration `1030`).
- **Fiche joueur conforme au RGPD** : e-mail masqué (affichage complet réservé aux administrateurs, motivé et journalisé), dernière activité, succès ; jamais de mot de passe ni de position.
- **Écran Confidentialité** (données, accès, durées, droits) et **suppression de compte** par le joueur (droit à l'effacement ; salons transmis à un autre membre ; migration `1040`).

### Tests
- 107 tests automatisés (dont 4 nouveaux : corrections, succès, RGPD, suppression de compte).
- **Test de bout en bout réel** du code e-mail sur le serveur de production : inscription, e-mail reçu, mauvais code refusé, bon code accepté, adresse confirmée, compte supprimé.
