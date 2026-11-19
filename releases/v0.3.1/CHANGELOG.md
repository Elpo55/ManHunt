# Projet Traque — v0.3.1 (build 301)

Correctif de livraison (build Android 301). **APK recommandé** : remplace v0.3.0 (conservée dans `releases/v0.3.0/`).

### Corrigé
- **Permissions Android superflues** retirées de l'APK : superposition d'écran (`SYSTEM_ALERT_WINDOW`), stockage externe (lecture/écriture), biométrie / empreinte, démarrage automatique, ainsi que les permissions Firebase Cloud Messaging et de badges de lanceurs (dépendance `expo-notifications` inutilisée supprimée). L'application ne demande plus que la localisation, le service de premier plan, Internet, les notifications et la vibration.
- **Contrôle de livraison** : le bundle JavaScript de l'APK n'était pas réellement lu (extraction `tar` impossible sous Windows) ; il est maintenant lu directement et vérifié (URL Supabase présente, jetons embarqués de rôle `anon` uniquement, aucune clé secrète du projet). Le rapport indique le bon certificat et le JDK réellement utilisé.

### Modifié
- Build natif : CMake 3.31.6 + ninja 1.12.1 (chemins longs Windows), compilation depuis une copie Git du commit livré (`C:/tqb`).
