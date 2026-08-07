HMPD POLICE MANAGEMENT SYSTEM — V6.0.0

V6 est une consolidation complète des versions précédentes, centrée sur stabilité, sécurité, cohérence Discord/Neon et performance.

CORRECTIONS CRITIQUES
- Protection High Grade + hiérarchie côté serveur.
- Auto-modification interdite : points, notes, sanctions, RP Quality, promotions et administration de présence.
- Même protection ajoutée aux commandes Discord / points et à l'administration de présence Discord.
- Correction du contournement possible sur sanctions : une sanction ne peut être modifiée/supprimée qu'avec son vrai user_id propriétaire.
- Rôles Discord vérifiés à nouveau sur les actions sensibles pour éviter un cache de permissions obsolète.
- Suppression des dossiers fantômes : les lectures ne recréent plus un ancien policier sans rôle Police.
- Retrait du rôle Police : suppression complète du dossier ; les anciennes actions du membre sur les autres dossiers sont anonymisées en FORMER_OFFICER.
- Protection anti-effacement massif lors d'une panne Discord conservée.

PROMOTIONS V6
- 2h minimum = 1 journée validée.
- Les journées sont cumulatives depuis la prise du grade, pas limitées à une semaine.
- Les sessions traversant minuit sont réparties sur les vraies journées Europe/Brussels.
- Affichage plafonné à 7/7.
- Anti-doublon PROMOTION CANDIDATE atomique en PostgreSQL.
- Approbation concurrente protégée par verrou PostgreSQL inter-instance.
- Promotion officielle affiche le validateur et le motif.
- Promotion forcée possible avec motif obligatoire et audit.
- Un changement réel de grade ferme le cycle de carrière précédent : si le membre revient plus tard au même grade, un nouveau dossier propre est créé.
- Synchronisation rôle/points sécurisée contre la course entre GuildMemberUpdate et une promotion depuis le MDT.
- En cas d'échec DB après modification Discord, tentative de rollback du rôle.

PRÉSENCE V6
- Calcul jour/semaine/mois en heure Europe/Brussels avec prise en compte des sessions traversant les limites de période.
- Correction des événements temps réel force-stop / force-pause.
- Administration Discord protégée par auto-modification + hiérarchie.
- Maintenance des sessions abandonnées limitée à une cadence horaire au lieu de chaque sync.

PERFORMANCE / QUALITÉ
- Cache court du Centre Promotions.
- Nettoyage périodique DB moins agressif.
- Cache busting V6 pour CSS/JS après déploiement.
- Validation de configuration au démarrage : IDs invalides, doublons de rôles, variables critiques.
- `npm run check` couvre désormais auth, présence, synchronisation, frontend et scripts critiques.
- `npm run verify` ajoute un self-test V6 des invariants critiques.
- Health endpoint annonce V6.0.0.
- Ancien code/dashboard V3/V4/V5 inutile retiré du package pour éviter les erreurs de maintenance.

IMPORTANT
La vérification syntaxique et les self-tests sont passés. Les tests réels Discord + Neon nécessitent tes vraies variables Render et ton serveur Discord.
