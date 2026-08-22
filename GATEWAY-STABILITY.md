# HMPD V7.3.1 — stabilité Discord Gateway

La version 7.3.1 démarre par défaut avec uniquement l'intent `Guilds`.
Cela évite les coupures Discord `4014 / Disallowed intents` lorsque **Server Members Intent** est désactivé dans le Developer Portal.

## Configuration Render recommandée

```env
ENABLE_GUILD_MEMBERS_INTENT=false
```

La présence, les boutons et le dashboard continuent de fonctionner. Le dashboard interroge les membres via l'API REST Discord.

Si tu veux les événements instantanés `GuildMemberUpdate` / `GuildMemberRemove`, active d'abord **Server Members Intent** dans Discord Developer Portal > Bot > Privileged Gateway Intents, puis mets :

```env
ENABLE_GUILD_MEMBERS_INTENT=true
```

## Diagnostic ajouté

Les logs indiquent désormais : déconnexion Gateway, code de fermeture, raison, tentative de reconnexion, reprise de session et erreurs/warnings Discord. Un code `4014` affiche une instruction explicite.
