# Quotas des services gratuits et consommation estimée

> Les chiffres des fournisseurs évoluent. Vérifiez-les sur les pages officielles avant de vous y fier :
> [Supabase – Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Supabase – Realtime quotas](https://supabase.com/docs/guides/realtime/quotas), [Supabase – Pricing](https://supabase.com/pricing), [Cloudflare Pages – limits](https://developers.cloudflare.com/pages/platform/limits).

## Supabase (forfait Free)

| Ressource | Limite gratuite (à vérifier) | Usage du jeu |
|-----------|------------------------------|--------------|
| Connexions Realtime simultanées | 200 (doc officielle) | 1 connexion WebSocket par joueur (3 à 4 canaux dessus) → 20 joueurs ≈ 20 connexions |
| Messages Realtime par seconde | 100 (doc officielle) ; au-delà, des connexions sont coupées | voir estimation ci-dessous |
| Messages Realtime par mois | ~2 millions selon des sources tierces | voir estimation |
| Base de données | ~500 Mo selon des sources tierces | ~1–2 Mo par partie de 20 joueurs × 15 min (événements) |
| Utilisateurs actifs (Auth) | large (dizaines de milliers) | négligeable |
| Inscriptions anonymes | 30 / heure / IP par défaut (réglable) | 1 par nouvel appareil |
| E-mails du service intégré | très limités (quelques-uns par heure) | uniquement pour les comptes e-mail |
| **Mise en pause** | un projet gratuit inactif ~7 jours est mis en pause | le relancer depuis le tableau de bord (voir REMAINING_TASKS) |

Le forfait gratuit **ne facture jamais** : en cas de dépassement, Supabase restreint le service. Aucune carte bancaire n'est nécessaire.

### Estimation des messages Realtime

Un message envoyé à un canal compte une fois par destinataire.

Mesure issue de la simulation moteur (`tests/db/simulation.test.ts`, 20 joueurs, ~5 actions/s au total) :
**≈ 55 messages délivrés par seconde** (13 150 livraisons en 240 s).

| Scénario | Messages/s | Partie de 15 min | Parties possibles / mois (2 M) |
|----------|-----------:|-----------------:|-------------------------------:|
| 10 joueurs, jeu calme | ~10–15 | ~11 000 | ~180 |
| 20 joueurs, jeu actif | ~55 | ~50 000 | ~40 |
| 20 joueurs, très actif (réserve de pas 10, régénération 0,5 s) | 80–120 | ~100 000 | ~20 |

Le dernier scénario peut approcher la limite de 100 messages/s : gardez une régénération des pas ≥ 1 s pour 20 joueurs.

Leviers pour réduire la consommation : régénération des pas plus lente, intervalle radar plus long, moins de joueurs par salon.

### Mesurer la consommation

- **Dans l'application** : Réglages > « Afficher le diagnostic » (compteurs de la session) ; pour l'administrateur, Réglages > « Administration : consommation des quotas » (taille de la base, livraisons Realtime estimées par jour et par mois).
- **Côté Supabase** : tableau de bord > *Reports* / *Usage* (consommation réelle officielle).

## Cloudflare Pages (forfait Free)

| Ressource | Limite | Usage |
|-----------|--------|-------|
| Builds | 500 / mois, 1 à la fois, 20 min max | 1 build par `git push` sur la branche suivie |
| Requêtes / bande passante statiques | illimitées | site 100 % statique |
| Pages Functions | non utilisées | 0 |

## GitHub

Dépôt privé gratuit. Aucune GitHub Action n'est requise (le build est fait par Cloudflare).
