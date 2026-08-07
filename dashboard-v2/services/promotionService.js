const { pool, ready } = require('../../database');
const { GRADES, getGradeIndex, normalizeGradeName } = require('../config/grades');
const { getPromotionRequirement } = require('../config/promotionRequirements');
const { getOfficerProfile, invalidateOfficerCache } = require('./officerService');
const { setMemberGradeRole, sendChannelMessage } = require('./discordService');
const { audit } = require('./managementService');

const PROMOTION_CHANNEL_ID = String(process.env.PROMOTION_CHANNEL_ID || '').trim();

const schemaReady = ready.then(() => pool.query(`
  ALTER TABLE officers ADD COLUMN IF NOT EXISTS rank_started_at TIMESTAMPTZ;
  UPDATE officers SET rank_started_at=COALESCE(rank_started_at, created_at, CURRENT_TIMESTAMP) WHERE rank_started_at IS NULL;

  CREATE TABLE IF NOT EXISTS promotion_cases (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    from_grade TEXT NOT NULL,
    to_grade TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'progress' CHECK(status IN ('progress','eligible','evaluation','approved','rejected','postponed','frozen')),
    decision_reason TEXT,
    opened_by TEXT NOT NULL,
    decided_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMPTZ,
    eligible_notified_at TIMESTAMPTZ
  );
  ALTER TABLE promotion_cases ADD COLUMN IF NOT EXISTS eligible_notified_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_promotion_cases_user ON promotion_cases(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_promotion_cases_status ON promotion_cases(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS promotion_criteria (
    case_id BIGINT NOT NULL REFERENCES promotion_cases(id) ON DELETE CASCADE,
    criterion_key TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(case_id, criterion_key)
  );

  CREATE TABLE IF NOT EXISTS rp_evaluations (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    professionalism SMALLINT NOT NULL CHECK(professionalism BETWEEN 1 AND 5),
    procedures SMALLINT NOT NULL CHECK(procedures BETWEEN 1 AND 5),
    radio SMALLINT NOT NULL CHECK(radio BETWEEN 1 AND 5),
    teamwork SMALLINT NOT NULL CHECK(teamwork BETWEEN 1 AND 5),
    reports SMALLINT NOT NULL CHECK(reports BETWEEN 1 AND 5),
    responsiveness SMALLINT NOT NULL CHECK(responsiveness BETWEEN 1 AND 5),
    hierarchy SMALLINT NOT NULL CHECK(hierarchy BETWEEN 1 AND 5),
    comment TEXT,
    evaluator_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_rp_eval_user ON rp_evaluations(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS grade_history (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    from_grade TEXT,
    to_grade TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'promotion',
    reason TEXT,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_grade_history_user ON grade_history(user_id, created_at DESC);
`));

function safeId(v){const s=String(v||'').trim();if(!/^\d{16,22}$/.test(s))throw Object.assign(new Error('Identifiant Discord invalide.'),{status:400});return s;}
function clean(v,max=2000){const s=String(v||'').trim();if(s.length>max)throw Object.assign(new Error('Texte trop long.'),{status:400});return s;}
function normalizeStars(v){const n=Number(v);if(!Number.isInteger(n)||n<1||n>5)throw Object.assign(new Error('Chaque note RP doit être comprise entre 1 et 5.'),{status:400});return n;}
function rpScore(row){if(!row)return null;const keys=['professionalism','procedures','radio','teamwork','reports','responsiveness','hierarchy'];return Math.round(keys.reduce((a,k)=>a+Number(row[k]||0),0)/(keys.length*5)*100);}

async function getOrCreateCase(userId, actorId='SYSTEM'){
  await schemaReady;
  const officer=await getOfficerProfile(safeId(userId));
  const from=normalizeGradeName(officer.grade);
  const req=getPromotionRequirement(from);
  if(!req)return {officer,case:null,requirement:null};
  const existing=await pool.query(`SELECT * FROM promotion_cases WHERE user_id=$1 AND from_grade=$2 AND to_grade=$3 AND status <> 'approved' ORDER BY id DESC LIMIT 1`,[userId,from,req.target]);
  let c=existing.rows[0];
  if(!c){
    c=(await pool.query(`INSERT INTO promotion_cases(user_id,from_grade,to_grade,opened_by) VALUES($1,$2,$3,$4) RETURNING *`,[userId,from,req.target,String(actorId||'SYSTEM')])).rows[0];
    for(const [key] of req.criteria) await pool.query(`INSERT INTO promotion_criteria(case_id,criterion_key) VALUES($1,$2) ON CONFLICT DO NOTHING`,[c.id,key]);
  }
  return {officer,case:c,requirement:req};
}

async function getPromotionProfile(userId, actorId='SYSTEM'){
  const base=await getOrCreateCase(userId,actorId); if(!base.case)return {...base,progress:null,evaluation:null,history:[]};
  await pool.query(`UPDATE officer_sanctions SET status='expired' WHERE user_id=$1 AND status='active' AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP`,[userId]);
  const criteria=(await pool.query(`SELECT criterion_key,completed,note,updated_by,updated_at FROM promotion_criteria WHERE case_id=$1`,[base.case.id])).rows;
  const map=new Map(criteria.map(x=>[x.criterion_key,x]));
  const items=base.requirement.criteria.map(([key,label])=>({key,label,completed:Boolean(map.get(key)?.completed),note:map.get(key)?.note||null,updated_by:map.get(key)?.updated_by||null}));
  const activeSanctions=Number((await pool.query(`SELECT COUNT(*)::int n FROM officer_sanctions WHERE user_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,[userId])).rows[0]?.n||0);
  const rankStarted=(await pool.query(`SELECT rank_started_at FROM officers WHERE user_id=$1`,[userId])).rows[0]?.rank_started_at;
  const daysInRank=rankStarted?Math.max(0,Math.floor((Date.now()-new Date(rankStarted).getTime())/86400000)):0;
  const minDays=Number(base.requirement.minDaysInRank||0);
  const daysOk=base.requirement.appointmentOnly?true:daysInRank>=minDays;
  const disciplineOk=activeSanctions===0;
  const manualDone=items.filter(x=>x.completed).length;
  const denominator=items.length+(base.requirement.appointmentOnly?0:2);
  const numerator=manualDone+(base.requirement.appointmentOnly?0:(daysOk?1:0)+(disciplineOk?1:0));
  const percent=denominator?Math.round(numerator/denominator*100):100;
  const eligible=items.every(x=>x.completed)&&daysOk&&disciplineOk;
  let status=base.case.status;
  if(activeSanctions>0) status='frozen';
  else if(['progress','eligible','frozen'].includes(status)) status=eligible?'eligible':'progress';
  if(status!==base.case.status) await pool.query(`UPDATE promotion_cases SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[base.case.id,status]);
  const evaluation=(await pool.query(`SELECT * FROM rp_evaluations WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,[userId])).rows[0]||null;
  const history=(await pool.query(`SELECT * FROM grade_history WHERE user_id=$1 ORDER BY id DESC LIMIT 20`,[userId])).rows;
  const sanctions=(await pool.query(`SELECT id,sanction_type,reason,author_id,expires_at,status,created_at FROM officer_sanctions WHERE user_id=$1 ORDER BY id DESC LIMIT 50`,[userId])).rows;
  const currentCase=(await pool.query(`SELECT * FROM promotion_cases WHERE id=$1`,[base.case.id])).rows[0]||{...base.case,status};
  if(eligible && !currentCase.eligible_notified_at && PROMOTION_CHANNEL_ID){
    const evalScore=rpScore(evaluation);
    await sendChannelMessage(PROMOTION_CHANNEL_ID,{embeds:[{color:0x2ecc71,title:'🎖️ PROMOTION CANDIDATE',description:`👤 **Agent :** <@${userId}>\n🎖️ **Promotion :** ${base.case.from_grade} → ${base.case.to_grade}\n⭐ **Points d’activité :** ${base.officer.points}\n📅 **Temps au grade :** ${daysInRank} jour(s)${evalScore?`\n🎭 **RP Quality :** ${evalScore}/100`:''}\n⚠️ **Sanctions actives :** ${activeSanctions}\n\n✅ Toutes les conditions du dossier sont remplies.\n**La décision finale appartient au High Command.**`,timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).then(()=>pool.query(`UPDATE promotion_cases SET eligible_notified_at=CURRENT_TIMESTAMP WHERE id=$1 AND eligible_notified_at IS NULL`,[base.case.id])).catch(()=>{});
  }
  return {...base,case:{...currentCase,status},progress:{percent,eligible,appointmentOnly:Boolean(base.requirement.appointmentOnly),daysInRank,minDays,daysOk,activeSanctions,disciplineOk,completed:manualDone,total:items.length,criteria:items},evaluation:evaluation?{...evaluation,score:rpScore(evaluation)}:null,history,sanctions};
}

async function setCriterion({userId,key,completed,note,actorId}){
  const p=await getPromotionProfile(userId,actorId); if(!p.case)throw Object.assign(new Error('Aucune promotion disponible.'),{status:400});
  if(!p.requirement.criteria.some(([k])=>k===key))throw Object.assign(new Error('Critère inconnu.'),{status:400});
  await pool.query(`INSERT INTO promotion_criteria(case_id,criterion_key,completed,note,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT(case_id,criterion_key) DO UPDATE SET completed=EXCLUDED.completed,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,[p.case.id,key,Boolean(completed),clean(note,1000)||null,String(actorId)]);
  await audit({actorId,action:'promotion.criterion',targetId:userId,details:{key,completed:Boolean(completed),note:clean(note,1000)}}).catch(()=>{});
  return getPromotionProfile(userId,actorId);
}

async function addRpEvaluation({userId,ratings,comment,actorId}){
  await schemaReady; safeId(userId);
  const vals=['professionalism','procedures','radio','teamwork','reports','responsiveness','hierarchy'].map(k=>normalizeStars(ratings?.[k]));
  const row=(await pool.query(`INSERT INTO rp_evaluations(user_id,professionalism,procedures,radio,teamwork,reports,responsiveness,hierarchy,comment,evaluator_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[userId,...vals,clean(comment,2000)||null,String(actorId)])).rows[0];
  await audit({actorId,action:'rp_evaluation.add',targetId:userId,details:{score:rpScore(row)}}).catch(()=>{});
  return {...row,score:rpScore(row)};
}

async function setCaseStatus({userId,status,reason,actorId}){
  const allowed=['progress','evaluation','postponed','rejected']; if(!allowed.includes(status))throw Object.assign(new Error('Action de promotion invalide.'),{status:400});
  const p=await getPromotionProfile(userId,actorId); if(!p.case)throw Object.assign(new Error('Aucune promotion disponible.'),{status:400});
  if(status==='evaluation'&&!p.progress.eligible)throw Object.assign(new Error('Le dossier ne remplit pas encore toutes les conditions.'),{status:400});
  await pool.query(`UPDATE promotion_cases SET status=$2,decision_reason=$3,decided_by=$4,updated_at=CURRENT_TIMESTAMP,decided_at=CASE WHEN $2 IN ('rejected','postponed') THEN CURRENT_TIMESTAMP ELSE decided_at END WHERE id=$1`,[p.case.id,status,clean(reason,2000)||null,String(actorId)]);
  await audit({actorId,action:`promotion.${status}`,targetId:userId,details:{from:p.case.from_grade,to:p.case.to_grade,reason:clean(reason,2000)}}).catch(()=>{});
  return getPromotionProfile(userId,actorId);
}

async function approvePromotion({userId,reason,actorId}){
  const p=await getPromotionProfile(userId,actorId); if(!p.case)throw Object.assign(new Error('Aucune promotion disponible.'),{status:400});
  if(!p.progress.eligible && !p.progress.appointmentOnly)throw Object.assign(new Error('Toutes les conditions obligatoires ne sont pas remplies.'),{status:400});
  if(p.progress.activeSanctions>0)throw Object.assign(new Error('La promotion est gelée par une sanction active.'),{status:400});
  const target=GRADES.find(g=>g.name===p.case.to_grade); if(!target?.roleId)throw new Error(`Rôle Discord manquant pour ${p.case.to_grade}.`);
  const currentIndex=getGradeIndex(p.case.from_grade), targetIndex=getGradeIndex(p.case.to_grade); if(targetIndex!==currentIndex+1)throw new Error('Transition de grade invalide.');
  await setMemberGradeRole(userId,target.roleId);
  const client=await pool.connect();
  try{await client.query('BEGIN');
    await client.query(`UPDATE officers SET grade=$2,rank_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`,[userId,p.case.to_grade]);
    await client.query(`UPDATE promotion_cases SET status='approved',decision_reason=$2,decided_by=$3,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[p.case.id,clean(reason,2000)||null,String(actorId)]);
    await client.query(`INSERT INTO grade_history(user_id,from_grade,to_grade,action,reason,actor_id) VALUES($1,$2,$3,'promotion',$4,$5)`,[userId,p.case.from_grade,p.case.to_grade,clean(reason,2000)||null,String(actorId)]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  invalidateOfficerCache();
  if(PROMOTION_CHANNEL_ID) await sendChannelMessage(PROMOTION_CHANNEL_ID,{content:`🎉 Félicitations <@${userId}> !`,embeds:[{color:0xf1c40f,title:'🎖️ PROMOTION OFFICIELLE',description:`👤 **Agent :** <@${userId}>\n⬆️ **Ancien grade :** ${p.case.from_grade}\n🏅 **Nouveau grade :** ${p.case.to_grade}\n⭐ **Points d’activité :** ${p.officer.points}\n\n*La promotion a été validée par le High Command.*`,timestamp:new Date().toISOString()}],allowed_mentions:{users:[userId],parse:[]}}).catch(()=>{});
  await audit({actorId,action:'promotion.approved',targetId:userId,details:{from:p.case.from_grade,to:p.case.to_grade,reason:clean(reason,2000)}}).catch(()=>{});
  return getPromotionProfile(userId,actorId);
}

async function listPromotionCenter(actorId='SYSTEM'){
  const { listOfficers }=require('./officerService');
  const officers=await listOfficers();
  const profiles=[];

  // Traitement parallèle limité : assez rapide pour 50-150 policiers sans
  // saturer le pool Neon (10 connexions par défaut).
  const concurrency=Math.min(6,Math.max(1,officers.length));
  let cursor=0;
  const workers=Array.from({length:concurrency},async()=>{
    while(true){
      const index=cursor++;
      if(index>=officers.length)break;
      const o=officers[index];
      const p=await getPromotionProfile(o.user_id,actorId);
      if(p.case)profiles[index]={
        user_id:o.user_id,display_name:o.display_name,avatar_url:o.avatar_url,
        grade:o.grade,points:o.points,to_grade:p.case.to_grade,status:p.case.status,
        progress:p.progress,evaluation:p.evaluation
      };
    }
  });
  await Promise.all(workers);
  return profiles.filter(Boolean);
}

module.exports={schemaReady,getPromotionProfile,setCriterion,addRpEvaluation,setCaseStatus,approvePromotion,listPromotionCenter};
