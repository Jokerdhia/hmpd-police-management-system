const { pool, ready } = require('../../database');
const { enrichOfficers } = require('./officerService');

const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const hours=s=>Number(s||0)/3600;
const pct=(current,previous)=>{
  const c=Number(current||0),p=Number(previous||0);
  if(!p)return c>0?100:0;
  return Math.round(((c-p)/p)*100);
};

function scoreOfficer(row){
  const attendance=clamp(hours(row.week_seconds)/14*100,0,100);
  const activity=clamp(Number(row.week_sessions||0)/5*100,0,100);
  const points=clamp(Number(row.points||0)/100*100,0,100);
  const discipline=clamp(100-Number(row.active_sanctions||0)*30,0,100);
  const regularity=clamp(Number(row.active_days_30||0)/12*100,0,100);
  const rp=row.rp_score==null?70:clamp(Number(row.rp_score),0,100);
  const total=Math.round(attendance*.25+activity*.15+points*.15+discipline*.20+regularity*.10+rp*.15);
  return {total,attendance:Math.round(attendance),activity:Math.round(activity),points:Math.round(points),discipline:Math.round(discipline),regularity:Math.round(regularity),rp:Math.round(rp),label:total>=85?'Excellent':total>=70?'Bon':total>=50?'À surveiller':'Inactif'};
}

let snapshotCache=null;
let snapshotCacheAt=0;
let snapshotPromise=null;
const SNAPSHOT_TTL_MS=Math.max(30000,Number(process.env.COMMAND_CENTER_CACHE_TTL_MS)||60000);

async function buildManagementSnapshot(){
  await ready;
  const [{rows},promotionResult,activeResult,coverageResult,trendResult,longServiceResult]=await Promise.all([
    pool.query(`
      WITH a AS (
        SELECT user_id,
          COALESCE(SUM(CASE WHEN started_at>=(date_trunc('week',CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') AT TIME ZONE 'Europe/Brussels') THEN COALESCE(duration_seconds, GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (COALESCE(paused_at,CURRENT_TIMESTAMP)-started_at)))::int-COALESCE(paused_seconds,0))) ELSE 0 END),0)::bigint week_seconds,
          COUNT(*) FILTER (WHERE started_at>=(date_trunc('week',CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Brussels') AT TIME ZONE 'Europe/Brussels'))::int week_sessions,
          COUNT(DISTINCT date_trunc('day',started_at AT TIME ZONE 'Europe/Brussels')) FILTER (WHERE started_at>=CURRENT_TIMESTAMP-interval '30 days')::int active_days_30,
          MAX(started_at) last_service
        FROM attendance_sessions GROUP BY user_id
      ), s AS (
        SELECT user_id,COUNT(*) FILTER (WHERE status='active' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP))::int active_sanctions
        FROM officer_sanctions GROUP BY user_id
      ), rp AS (
        SELECT DISTINCT ON (user_id) user_id,
          ROUND(((professionalism+procedures+radio+teamwork+reports+responsiveness+hierarchy)::numeric/35)*100)::int rp_score
        FROM rp_evaluations ORDER BY user_id,id DESC
      )
      SELECT o.user_id,o.points,o.grade,o.created_at,o.updated_at,
        COALESCE(a.week_seconds,0)::bigint week_seconds,COALESCE(a.week_sessions,0)::int week_sessions,
        COALESCE(a.active_days_30,0)::int active_days_30,a.last_service,
        COALESCE(s.active_sanctions,0)::int active_sanctions,rp.rp_score
      FROM officers o LEFT JOIN a USING(user_id) LEFT JOIN s USING(user_id) LEFT JOIN rp USING(user_id)
      ORDER BY o.points DESC`),
    pool.query(`SELECT DISTINCT ON (user_id) user_id,status,to_grade FROM promotion_cases ORDER BY user_id,id DESC`).catch(()=>({rows:[]})),
    pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE paused_at IS NOT NULL)::int paused FROM attendance_sessions WHERE ended_at IS NULL`),
    pool.query(`SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'Europe/Brussels')::int AS hour_of_day, COUNT(DISTINCT user_id)::int AS officers FROM attendance_sessions WHERE started_at >= CURRENT_TIMESTAMP - interval '30 days' GROUP BY 1 ORDER BY 1`),
    pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN started_at>=CURRENT_TIMESTAMP-interval '7 days' THEN COALESCE(duration_seconds,0) ELSE 0 END),0)::bigint current_seconds,
        COALESCE(SUM(CASE WHEN started_at>=CURRENT_TIMESTAMP-interval '14 days' AND started_at<CURRENT_TIMESTAMP-interval '7 days' THEN COALESCE(duration_seconds,0) ELSE 0 END),0)::bigint previous_seconds,
        COUNT(*) FILTER(WHERE started_at>=CURRENT_TIMESTAMP-interval '7 days')::int current_sessions,
        COUNT(*) FILTER(WHERE started_at>=CURRENT_TIMESTAMP-interval '14 days' AND started_at<CURRENT_TIMESTAMP-interval '7 days')::int previous_sessions
      FROM attendance_sessions WHERE started_at>=CURRENT_TIMESTAMP-interval '14 days'`),
    pool.query(`SELECT user_id,started_at,paused_at,GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (COALESCE(paused_at,CURRENT_TIMESTAMP)-started_at)))::bigint-COALESCE(paused_seconds,0))::bigint active_seconds FROM attendance_sessions WHERE ended_at IS NULL`).catch(()=>({rows:[]}))
  ]);

  const base=rows.map(r=>({...r,week_seconds:Number(r.week_seconds||0),score:scoreOfficer(r)}));
  let enriched=[];
  try{enriched=await enrichOfficers(base)}catch(error){console.error('❌ Vérification Discord Command Center :',error?.message||error)}
  const activePoliceOfficers=enriched.filter(o=>o&&o.is_in_server===true&&o.has_police_role===true);
  const promotionMap=new Map((promotionResult.rows||[]).map(r=>[String(r.user_id),r]));
  const longServiceMap=new Map((longServiceResult.rows||[]).map(r=>[String(r.user_id),Number(r.active_seconds||0)]));
  const now=Date.now();
  const officers=activePoliceOfficers.map(o=>{
    const inactiveDays=o.last_service?Math.floor((now-new Date(o.last_service).getTime())/86400000):999;
    const promotion=promotionMap.get(String(o.user_id));
    return {...o,inactive_days:inactiveDays,promotion_status:promotion?.status||'progress',promotion_eligible:promotion?.status==='eligible',next_grade:promotion?.to_grade||o.next_grade,active_service_seconds:longServiceMap.get(String(o.user_id))||0};
  });

  const alerts=[];
  const push=(o,severity,type,message,priority)=>alerts.push({severity,type,user_id:o.user_id,message,priority:Number(priority||0)});
  for(const o of officers){
    if(o.inactive_days>=14)push(o,'high','inactive',`Aucun service depuis ${o.inactive_days===999?'très longtemps':o.inactive_days+' jours'}`,100);
    else if(o.inactive_days>=7)push(o,'medium','inactive',`Inactif depuis ${o.inactive_days} jours`,70);
    if(Number(o.active_sanctions)>=1)push(o,Number(o.active_sanctions)>=2?'high':'medium','discipline',`${o.active_sanctions} sanction(s) active(s)`,95+Number(o.active_sanctions));
    if(Number(o.active_service_seconds)>=8*3600)push(o,'high','long_service',`Service ouvert depuis ${Math.floor(o.active_service_seconds/3600)} h — vérification requise`,110);
    if(o.promotion_eligible)push(o,'info','promotion',`Promotion prête à examiner : ${o.next_grade}`,80);
    else if(Number(o.points_until_next_grade||999)<=25&&o.next_grade)push(o,'info','promotion_near',`Proche du seuil ${o.next_grade} · ${o.points_until_next_grade} point(s) restant(s)`,55);
    if(o.score.total>=90&&o.inactive_days<7)push(o,'info','performance',`Excellente performance · ${o.score.total}/100`,30);
    if(o.rp_score==null&&o.inactive_days<7)push(o,'medium','evaluation',`Évaluation RP à planifier`,60);
    if(Number(o.points||0)>=100&&Number(o.week_seconds||0)<30*60&&o.inactive_days<7)push(o,'medium','points_presence',`Points élevés mais faible présence cette semaine (${Math.floor(Number(o.week_seconds||0)/60)} min)`,65);
  }
  alerts.sort((a,b)=>b.priority-a.priority||String(a.user_id).localeCompare(String(b.user_id)));

  const coverage=Array.from({length:24},(_,hour)=>({hour,officers:Number((coverageResult.rows||[]).find(x=>Number(x.hour_of_day)===hour)?.officers||0)}));
  const recentActivity=await getRecentCommandActivity(24);
  const t=trendResult.rows?.[0]||{};
  const trends={servicePct:pct(t.current_seconds,t.previous_seconds),sessionsPct:pct(t.current_sessions,t.previous_sessions),currentSeconds:Number(t.current_seconds||0),previousSeconds:Number(t.previous_seconds||0)};
  const summary={
    officers:officers.length,onDuty:Number(activeResult.rows[0]?.total||0),paused:Number(activeResult.rows[0]?.paused||0),
    inactive7:officers.filter(o=>o.inactive_days>=7).length,promotionEligible:officers.filter(o=>o.promotion_eligible).length,
    averageScore:officers.length?Math.round(officers.reduce((a,o)=>a+o.score.total,0)/officers.length):0,
    excellent:officers.filter(o=>o.score.total>=90).length,
    needsAttention:officers.filter(o=>o.score.total<50||o.inactive_days>=7||o.active_sanctions>0).length,
    criticalAlerts:alerts.filter(a=>a.severity==='high').length
  };
  const priorities=alerts.filter(a=>a.severity!=='info'||['promotion','long_service'].includes(a.type)).slice(0,5);
  return {officers,alerts:alerts.slice(0,40),priorities,coverage,recentActivity,trends,generatedAt:new Date().toISOString(),summary};
}

async function getManagementSnapshot({force=false}={}){
  const fresh=snapshotCache&&Date.now()-snapshotCacheAt<SNAPSHOT_TTL_MS;
  if(!force&&fresh)return snapshotCache;
  if(snapshotPromise)return snapshotPromise;
  snapshotPromise=buildManagementSnapshot().then(result=>{snapshotCache=result;snapshotCacheAt=Date.now();return result}).finally(()=>{snapshotPromise=null});
  return snapshotPromise;
}

async function getRecentCommandActivity(limit=24){
  await ready;
  const max=Math.min(Math.max(parseInt(limit,10)||24,1),60),items=[];
  const add=(rows,type,title,detail,valueFn=null)=>{for(const row of rows||[])items.push({type,user_id:String(row.user_id||row.target_id||''),actor_id:String(row.moderator_id||row.started_by||row.ended_by||row.author_id||''),title:title(row),detail:detail(row),value:valueFn?valueFn(row):null,created_at:row.created_at})};
  const [points,starts,ends,sanctions,auditRows]=await Promise.all([
    pool.query(`SELECT user_id,action,amount,reason,moderator_id,created_at FROM points_history ORDER BY created_at DESC LIMIT $1`,[max]).catch(()=>({rows:[]})),
    pool.query(`SELECT user_id,started_by,created_at FROM (SELECT user_id,started_by,started_at AS created_at FROM attendance_sessions ORDER BY started_at DESC LIMIT $1) x`,[max]).catch(()=>({rows:[]})),
    pool.query(`SELECT user_id,ended_by,end_reason,duration_seconds,created_at FROM (SELECT user_id,ended_by,end_reason,duration_seconds,ended_at AS created_at FROM attendance_sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT $1) x`,[max]).catch(()=>({rows:[]})),
    pool.query(`SELECT user_id,sanction_type,reason,author_id,created_at FROM officer_sanctions ORDER BY created_at DESC LIMIT $1`,[max]).catch(()=>({rows:[]})),
    pool.query(`SELECT actor_id,target_id,action,details,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT $1`,[max]).catch(()=>({rows:[]}))
  ]);
  add(points.rows,'points',r=>r.action==='add'?`+${Number(r.amount||0)} points`:`-${Number(r.amount||0)} points`,r=>r.reason||'Modification des points',r=>Number(r.amount||0)*(r.action==='add'?1:-1));
  add(starts.rows,'attendance_start',()=>`Prise de service`,()=>`Service démarré`);
  add(ends.rows,'attendance_end',()=>`Fin de service`,r=>r.end_reason||'Service terminé',r=>Number(r.duration_seconds||0));
  add(sanctions.rows,'sanction',r=>`Sanction · ${r.sanction_type}`,r=>r.reason||'Sanction enregistrée');
  for(const r of auditRows.rows||[])items.push({type:'audit',user_id:String(r.target_id||''),actor_id:String(r.actor_id||''),title:humanizeAuditAction(r.action,r.details).label,detail:'Action High Command',value:null,created_at:r.created_at});
  const ids=[...new Set(items.flatMap(x=>[x.user_id,x.actor_id]).filter(x=>/^\d{16,22}$/.test(x)))],names=new Map();
  if(ids.length){try{for(const o of await enrichOfficers(ids.map(user_id=>({user_id})))||[])names.set(String(o.user_id),o.display_name||o.username||String(o.user_id))}catch{}}
  return items.filter(x=>x.created_at).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,max).map(x=>({...x,display_name:names.get(x.user_id)||x.user_id||'Système',actor_name:names.get(x.actor_id)||x.actor_id||'Système'}));
}

function humanizeAuditAction(action,details={}){
  const a=String(action||'').toLowerCase();
  const key=String(details?.criterion||details?.key||details?.criterionKey||'').trim();
  const map={
    'promotion.criterion':['Critère de promotion modifié','promotion','📋'],
    'promotion.approve':['Promotion approuvée','promotion','✅'],
    'promotion.status':['Statut de promotion modifié','promotion','🎖️'],
    'rp_evaluation.add':['Évaluation RP ajoutée','evaluation','⭐'],
    'sanction.add':['Sanction ajoutée','discipline','⚠️'],
    'sanction.delete':['Sanction supprimée','discipline','🗑️'],
    'points.add':['Points ajoutés','points','➕'],
    'points.remove':['Points retirés','points','➖']
  };
  let found=map[a];
  if(!found){if(a.includes('promotion'))found=['Action sur une promotion','promotion','🎖️'];else if(a.includes('sanction'))found=['Action disciplinaire','discipline','⚠️'];else if(a.includes('point'))found=['Modification des points','points','⭐'];else if(a.includes('evaluation'))found=['Évaluation RP','evaluation','📝'];else found=[String(action||'Action administrative').replace(/[._]/g,' '),'administration','🧾']}
  return {label:key?`${found[0]} · ${key}`:found[0],category:found[1],icon:found[2]};
}

async function getWeeklyPerformanceWinner(){const snap=await getManagementSnapshot();const eligible=snap.officers.filter(o=>Number(o.week_seconds||0)>=2*3600);const winner=[...eligible].sort((a,b)=>b.score.total-a.score.total||b.week_seconds-a.week_seconds)[0]||null;return winner?{...winner,performance_score:winner.score.total}:null}

async function getOfficerTimeline(userId,limit=80){
  await ready;const safe=String(userId),n=Math.min(Math.max(parseInt(limit)||50,1),100);
  const {rows}=await pool.query(`SELECT * FROM (
    SELECT created_at,'points' type,CASE WHEN action='add' THEN 'Points ajoutés' ELSE 'Points retirés' END title,reason detail,amount value,moderator_id actor FROM points_history WHERE user_id=$1
    UNION ALL SELECT created_at,'note','Note administrative',content,NULL,author_id FROM officer_notes WHERE user_id=$1
    UNION ALL SELECT created_at,'sanction','Sanction: '||sanction_type,reason,NULL,author_id FROM officer_sanctions WHERE user_id=$1
    UNION ALL SELECT started_at,'attendance','Prise de service','Session #'||id,NULL,started_by FROM attendance_sessions WHERE user_id=$1
    UNION ALL SELECT ended_at,'attendance','Fin de service',COALESCE(end_reason,'Fin normale'),duration_seconds,ended_by FROM attendance_sessions WHERE user_id=$1 AND ended_at IS NOT NULL
  ) x ORDER BY created_at DESC LIMIT $2`,[safe,n]);return rows;
}

async function audit({actorId,action,targetId=null,details={}}){await ready;await pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_id,details) VALUES($1,$2,$3,$4::jsonb)`,[String(actorId||'SYSTEM'),String(action),targetId?String(targetId):null,JSON.stringify(details||{})]);snapshotCache=null;snapshotCacheAt=0}

async function listAudit(limit=100,category='all'){
  await ready;const max=Math.min(parseInt(limit)||50,200);
  const rows=(await pool.query(`SELECT id,actor_id,action,target_id,details,created_at FROM admin_audit_log ORDER BY id DESC LIMIT $1`,[max])).rows;
  const ids=[...new Set(rows.flatMap(r=>[r.actor_id,r.target_id]).filter(x=>/^\d{16,22}$/.test(String(x||''))))],names=new Map();
  if(ids.length){try{for(const o of await enrichOfficers(ids.map(user_id=>({user_id})))||[])names.set(String(o.user_id),o.display_name||o.username||String(o.user_id))}catch{}}
  const result=rows.map(r=>{const h=humanizeAuditAction(r.action,r.details);return {...r,...h,actor_name:names.get(String(r.actor_id))||r.actor_id||'Système',target_name:names.get(String(r.target_id))||r.target_id||'Système'}});
  return category&&category!=='all'?result.filter(r=>r.category===category):result;
}

async function getWeeklyReport(){const snap=await getManagementSnapshot();const top=[...snap.officers].sort((a,b)=>b.week_seconds-a.week_seconds).slice(0,5);return {generatedAt:new Date().toISOString(),summary:snap.summary,trends:snap.trends,topAttendance:top.map(o=>({user_id:o.user_id,display_name:o.display_name,week_seconds:o.week_seconds,score:o.score.total})),inactive:snap.officers.filter(o=>o.inactive_days>=7).slice(0,20).map(o=>({user_id:o.user_id,display_name:o.display_name,inactive_days:o.inactive_days})),promotions:snap.officers.filter(o=>o.promotion_eligible).map(o=>({user_id:o.user_id,display_name:o.display_name,next_grade:o.next_grade,score:o.score.total}))}}

module.exports={getManagementSnapshot,getWeeklyPerformanceWinner,getOfficerTimeline,audit,listAudit,getWeeklyReport};
