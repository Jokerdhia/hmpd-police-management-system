const {REST,Routes}=require('discord.js');
const {getAllGradeRoleIds}=require('../config/grades');
const TOKEN=process.env.TOKEN,GUILD_ID=process.env.GUILD_ID;
if(!TOKEN)throw new Error('TOKEN absent du fichier .env.');
if(!GUILD_ID)throw new Error('GUILD_ID absent du fichier .env.');
const rest=new REST({version:'10'}).setToken(TOKEN),cache=new Map(),TTL=300000;
function defaultAvatar(id){try{return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id)>>22n)%6n)}.png`;}catch{return 'https://cdn.discordapp.com/embed/avatars/0.png';}}
function avatar(member){const u=member?.user;if(!u)return defaultAvatar('0');if(member.avatar){const e=member.avatar.startsWith('a_')?'gif':'png';return `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${u.id}/avatars/${member.avatar}.${e}?size=256`;}if(u.avatar){const e=u.avatar.startsWith('a_')?'gif':'png';return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${e}?size=256`;}return defaultAvatar(u.id);}
async function getDiscordMember(userId,force=false){const c=cache.get(userId);if(!force&&c&&Date.now()-c.time<TTL)return c.data;try{const m=await rest.get(Routes.guildMember(GUILD_ID,userId));const data={found:true,userId,displayName:m.nick||m.user?.global_name||m.user?.username||userId,username:m.user?.username||userId,avatarUrl:avatar(m),bot:Boolean(m.user?.bot),roles:Array.isArray(m.roles)?m.roles:[],joinedAt:m.joined_at||null};cache.set(userId,{time:Date.now(),data});return data;}catch{const data={found:false,userId,displayName:'Membre inconnu',username:userId,avatarUrl:defaultAvatar(userId),bot:false,roles:[],joinedAt:null};cache.set(userId,{time:Date.now(),data});return data;}}
async function setMemberGradeRole(userId,expectedRoleId){const member=await getDiscordMember(userId,true);if(!member.found)throw new Error("Le policier n'est plus présent dans le serveur.");if(member.bot)throw new Error("Les points d'un bot ne peuvent pas être modifiés.");const all=getAllGradeRoleIds();for(const roleId of member.roles.filter(r=>all.includes(r)&&r!==expectedRoleId)){await rest.delete(Routes.guildMemberRole(GUILD_ID,userId,roleId));}if(!member.roles.includes(expectedRoleId))await rest.put(Routes.guildMemberRole(GUILD_ID,userId,expectedRoleId));cache.delete(userId);return getDiscordMember(userId,true);}
async function sendChannelMessage(channelId,message){if(channelId)await rest.post(Routes.channelMessages(channelId),{body:message});}
function clearMemberCache(){cache.clear();}
module.exports={getDiscordMember,setMemberGradeRole,sendChannelMessage,clearMemberCache};
