# Sécurité

## Principes

1. **Le client n'est jamais cru** : il n'écrit dans aucune table de jeu. Chaque action passe par une fonction RPC qui vérifie l'identité (`auth.uid()`), l'appartenance, l'équipe, la phase, les recharges, les distances, puis applique l'effet dans une transaction verrouillée.
2. **Moindre privilège** : `revoke all` puis droits minimaux ; le rôle `anon` (clé publique sans session) ne peut rien exécuter ; les fonctions du schéma `private` ne sont pas exposées.
3. **Isolation des équipes** à trois niveaux : RLS sur les tables, privilèges de colonnes sur `games`, autorisation des canaux Realtime privés.

## Contrôles en place (testés)

| Menace | Protection | Test |
|--------|-----------|------|
| Lire la position d'un adversaire | RLS `player_states` (soi + équipe) ; `get_game_view` ne renvoie que les adversaires visibles | `security.test.ts` |
| Écouter le canal de l'autre équipe | politique `realtime.messages` → `can_access_topic` | `security.test.ts` |
| Garder l'écoute de son ancienne équipe (Infection) | rotation du topic Fugitif | `game.test.ts` (Infection) |
| Diffuser de faux événements | aucune politique d'insertion broadcast pour les clients | `security.test.ts` |
| Modifier sa position / son score | aucune écriture directe ; `permission denied` | `security.test.ts`, `rooms.test.ts` |
| Téléportation, traversée de murs | validation du chemin case par case | `game.test.ts` |
| Double capture / double impulsion radar | verrou `FOR UPDATE` par partie + index unique `radar_pulses` | `game.test.ts` |
| Spam d'actions | `private.rate_limit` (déplacement 6/s, capture 3/s, capacités 4/s, tick 30/10 s…) | `rooms.test.ts` |
| Force brute des codes de salon | 10 tentatives/min/utilisateur, comptées même en cas d'échec ; alphabet de 32 symboles × 6 = ~1 milliard de codes | `rooms.test.ts` |
| Rejoindre après exclusion | `room_bans` | `rooms.test.ts` |
| Actions d'hôte par un joueur | `lock_room_as_host` / `lock_game_as_host` | `rooms.test.ts`, `game.test.ts` |
| Lire les colonnes techniques (visibilité) | privilèges de colonnes | `security.test.ts` |
| Clé `service_role` exposée | jamais utilisée par l'application ; seules l'URL et la clé publique sont dans le frontend | revue |
| XSS | React échappe le contenu ; pseudos limités à `[A-Za-z0-9 accents _.-]` ; CSP stricte (`public/_headers`) | revue |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | revue |

## Limites connues

- Un joueur **capturé** (mode Classique) garde l'accès aux informations de son équipe (spectateur). Il pourrait les communiquer hors de l'application : c'est un risque social, pas technique.
- Un membre **exclu** reste connecté au canal du salon jusqu'à sa prochaine reconnexion ; ce canal ne transporte que des notifications de lobby (aucun secret de partie).
- Les comptes invités sont anonymes : un joueur peut recréer un profil. Pour un groupe privé c'est acceptable ; activer le CAPTCHA (Supabase > Authentication > Attack Protection) si l'URL circule largement.
- La CSP autorise `'unsafe-inline'` pour les scripts (nécessaire aux scripts d'amorçage de l'export statique Next.js).

## Bonnes pratiques d'exploitation

- Ne jamais commiter `.env.local` (déjà ignoré par Git).
- Ne jamais copier la clé `service_role` / « secret key » dans Cloudflare ni dans le code.
- Désactiver l'accès public Realtime (voir SETUP_GUIDE.md, étape Realtime) pour imposer les canaux privés.
- Garder les migrations comme seule source de modification du schéma.
