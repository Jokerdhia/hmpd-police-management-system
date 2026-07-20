INSTALLATION HMPD DASHBOARD V2

1. Arrête le Dashboard avec Ctrl + C.
2. Dans PowerShell :
   cd E:\hmpd-points-bot
   Rename-Item dashboard-v2 dashboard-v2-backup
3. Décompresse le ZIP.
4. Copie le dossier hmpd-dashboard-v2 dans E:\hmpd-points-bot\
5. Renomme-le dashboard-v2.
6. Vérifie dans .env :
   GUILD_ID=...
   DASHBOARD_PORT_V2=3001
   DASHBOARD_MODERATOR_ID=TON_ID_DISCORD
7. Installe si nécessaire :
   npm install express helmet express-rate-limit
8. Lance :
   node dashboard-v2\server.js
9. Ouvre : http://localhost:3001

Le fichier .env et le token Discord ne sont pas inclus.
