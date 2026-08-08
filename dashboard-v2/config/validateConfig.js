const { GRADES } = require('./grades');

function csv(value){return String(value||'').split(',').map(x=>x.trim()).filter(Boolean)}
function looksLikeDiscordId(value){return /^\d{16,22}$/.test(String(value||'').trim())}

function validateRuntimeConfig(){
  const errors=[]; const warnings=[];
  const required=['TOKEN','GUILD_ID','DATABASE_URL'];
  for(const key of required){if(!String(process.env[key]||'').trim())errors.push(`${key} est obligatoire.`)}
  const police=csv(process.env.ROLE_POLICE);
  if(!police.length) errors.push('ROLE_POLICE est obligatoire.');
  for(const id of police){if(!looksLikeDiscordId(id))errors.push(`ROLE_POLICE contient un ID invalide : ${id}`)}

  const seen=new Map();
  for(const grade of GRADES){
    const id=String(grade.roleId||'').trim();
    if(!id){warnings.push(`Rôle Discord non configuré pour ${grade.name}.`);continue}
    if(!looksLikeDiscordId(id)){errors.push(`ID de rôle invalide pour ${grade.name}: ${id}`);continue}
    if(seen.has(id)) errors.push(`Le même rôle Discord ${id} est configuré pour ${seen.get(id)} et ${grade.name}.`);
    else seen.set(id,grade.name);
  }
  for(const id of police){if(seen.has(id))warnings.push(`ROLE_POLICE utilise aussi le rôle de grade ${seen.get(id)} (${id}). Il est conseillé de séparer le rôle Police du grade.`)}

  const high=csv(process.env.ROLE_HIGH_GRADE||process.env.ROLE_HIGH_COMMAND);
  for(const id of high){if(!looksLikeDiscordId(id))warnings.push(`ID High Grade invalide ignoré : ${id}`)}
  const sync=Number(process.env.ROLE_SYNC_INTERVAL_MS||60000);
  if(Number.isFinite(sync)&&sync<30000)warnings.push('ROLE_SYNC_INTERVAL_MS < 30000 sera automatiquement limité à 30 secondes.');
  return {errors,warnings};
}

function logRuntimeConfig(){
  const report=validateRuntimeConfig();
  for(const warning of report.warnings)console.warn(`⚠️ CONFIG : ${warning}`);
  if(report.errors.length){
    for(const error of report.errors)console.error(`❌ CONFIG : ${error}`);
    const e=new Error(`Configuration HMPD invalide (${report.errors.length} erreur(s)).`);e.details=report.errors;throw e;
  }
  console.log(`✅ Configuration V7 validée (${GRADES.filter(g=>g.roleId).length}/${GRADES.length} rôles de grade configurés).`);
  return report;
}
module.exports={validateRuntimeConfig,logRuntimeConfig};
