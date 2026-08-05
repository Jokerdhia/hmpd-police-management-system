const { pool, ready } = require('../../database');
const { getAllOfficers } = require('../../database');
const { enrichOfficers } = require('./officerService');

const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
function hours(s){return Number(s||0)/3600}
function scoreOfficer(row){
  const attendance=clamp(hours(row.week_seconds)/20*100,0,100);
  const activity=clamp(Number(row.week_sessions||0)/5*100,0,100);
  const points=clamp(Number(row.points||0)/100*100,0,100);
  const discipline=clamp(100-Number(row.active_sanctions||0)*25,0,100);
  const regularity=clamp(Number(row.active_days_30||0)/12*100,0,100);
  const total=Math.round(attendance*.30+activity*.20+points*.20+discipline*.20+regularity*.10);
  return {total,attendance:Math.round(attendance),activity:Math.round(activity),points:Math.round(points),discipline:Math.round(discipline),regularity:Math.round(regularity),label:total>=85?'Excellent':total>=70?'Bon':total>=50?'À surveiller':'Inactif'};
}
async function getManagementSnapshot(){
  await ready;
  const {rows}=await pool.query(`
    WITH a AS (
      SELECT user_id,
        COALESCE(SUM(CASE WHEN started_at>=date_trunc('week',CURRENT_TIMESTAMP) THEN COALESCE(duration_seconds, GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (COALESCE(paused_at,CURRENT_TIMESTAMP)-started_at)))::int-COALESCE(paused_seconds,0))) ELSE 0 END),0)::bigint week_seconds,
        COUNT(*) FILTER (WHERE started_at>=date_trunc('week',CURRENT_TIMESTAMP))::int week_sessions,
        COUNT(DISTINCT date_trunc('day',started_at)) FILTER (WHERE started_at>=CURRENT_TIMESTAMP-interval '30 days')::int active_days_30,
        MAX(started_at) last_service
      FROM attendance_sessions GROUP BY user_id
    ), s AS (
      SELECT user_id,COUNT(*) FILTER (WHERE status='active' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP))::int active_sanctions
      FROM officer_sanctions GROUP BY user_id
    )
    SELECT o.user_id,o.points,o.grade,o.created_at,o.updated_at,
      COALESCE(a.week_seconds,0)::bigint week_seconds,COALESCE(a.week_sessions,0)::int week_sessions,
      COALESCE(a.active_days_30,0)::int active_days_30,a.last_service,
      COALESCE(s.active_sanctions,0)::int active_sanctions
    FROM officers o LEFT JOIN a USING(user_id) LEFT JOIN s USING(user_id)
    ORDER BY o.points DESC`);
  const base=rows.map(r=>({...r,week_seconds:Number(r.week_seconds||0),score:scoreOfficer(r)}));
  let enriched=base;
  try{
    enriched=await enrichOfficers(base);
  }catch(error){
    console.error('❌ Vérification des rôles Discord impossible pour le Command Center :', error?.message || error);
    enriched=[]; // fail closed: ne jamais afficher d'anciens policiers si Discord ne peut pas confirmer leur rôle actuel
  }

  // V3.0.2 : le Command Center ne doit considérer que les membres
  // actuellement présents sur Discord ET possédant encore le rôle Police.
  // Les anciennes lignes restent en base pour l'historique, mais elles ne
  // polluent plus les scores, alertes, promotions ou rapports actuels.
  const activePoliceOfficers=enriched.filter(o=>
    o && o.is_in_server === true && o.has_police_role === true
  );

  const now=Date.now();
  const officers=activePoliceOfficers.map(o=>{
    const inactiveDays=o.last_service?Math.floor((now-new Date(o.last_service).getTime())/86400000):999;
    const eligible=Number(o.points)>=Number(o.next_grade_points||Infinity)-0 && Number(o.active_sanctions)===0 && Number(o.week_seconds)>=8*3600;
    return {...o,inactive_days:inactiveDays,promotion_eligible:Boolean(o.next_grade&&eligible)};
  });
  const alerts=[];
  for(const o of officers){
    if(o.inactive_days>=14) alerts.push({severity:'high',type:'inactive',user_id:o.user_id,message:`Aucun service depuis ${o.inactive_days===999?'très longtemps':o.inactive_days+' jours'}`});
    else if(o.inactive_days>=7) alerts.push({severity:'medium',type:'inactive',user_id:o.user_id,message:`Inactif depuis ${o.inactive_days} jours`});
    if(Number(o.active_sanctions)>=2) alerts.push({severity:'high',type:'discipline',user_id:o.user_id,message:`${o.active_sanctions} sanctions actives`});
    if(o.promotion_eligible) alerts.push({severity:'info',type:'promotion',user_id:o.user_id,message:`Éligible à ${o.next_grade}`});
  }
  const active=await pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE paused_at IS NOT NULL)::int paused FROM attendance_sessions WHERE ended_at IS NULL`);
  const coverageRows=(await pool.query(`SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'Europe/Brussels')::int AS hour_of_day, COUNT(DISTINCT user_id)::int AS officers FROM attendance_sessions WHERE started_at >= CURRENT_TIMESTAMP - interval '30 days' GROUP BY 1 ORDER BY 1`)).rows;
  const coverage=Array.from({length:24},(_,hour)=>({hour,officers:Number(coverageRows.find(x=>Number(x.hour_of_day)===hour)?.officers||0)}));
  return {officers,alerts:alerts.slice(0,100),coverage,summary:{officers:officers.length,onDuty:Number(active.rows[0]?.total||0),paused:Number(active.rows[0]?.paused||0),inactive7:officers.filter(o=>o.inactive_days>=7).length,promotionEligible:officers.filter(o=>o.promotion_eligible).length,averageScore:officers.length?Math.round(officers.reduce((a,o)=>a+o.score.total,0)/officers.length):0}};
}
async function getOfficerTimeline(userId,limit=80){
 await ready; const safe=String(userId); const n=Math.min(Math.max(parseInt(limit)||50,1),100);
 const {rows}=await pool.query(`
   SELECT * FROM (
    SELECT created_at,'points' type,CASE WHEN action='add' THEN 'Points ajoutés' ELSE 'Points retirés' END title,reason detail,amount value,moderator_id actor FROM points_history WHERE user_id=$1
    UNION ALL SELECT created_at,'note','Note administrative',content,NULL,author_id FROM officer_notes WHERE user_id=$1
    UNION ALL SELECT created_at,'sanction','Sanction: '||sanction_type,reason,NULL,author_id FROM officer_sanctions WHERE user_id=$1
    UNION ALL SELECT started_at,'attendance','Prise de service','Session #'||id,NULL,started_by FROM attendance_sessions WHERE user_id=$1
    UNION ALL SELECT ended_at,'attendance','Fin de service',COALESCE(end_reason,'Fin normale'),duration_seconds,ended_by FROM attendance_sessions WHERE user_id=$1 AND ended_at IS NOT NULL
   ) x ORDER BY created_at DESC LIMIT $2`,[safe,n]); return rows;
}
async function audit({actorId,action,targetId=null,details={}}){await ready;await pool.query(`INSERT INTO admin_audit_log(actor_id,action,target_id,details) VALUES($1,$2,$3,$4::jsonb)`,[String(actorId||'SYSTEM'),String(action),targetId?String(targetId):null,JSON.stringify(details||{})]);}
async function listAudit(limit=100){await ready;return (await pool.query(`SELECT id,actor_id,action,target_id,details,created_at FROM admin_audit_log ORDER BY id DESC LIMIT $1`,[Math.min(parseInt(limit)||50,200)])).rows}
async function getWeeklyReport(){const snap=await getManagementSnapshot();const top=[...snap.officers].sort((a,b)=>b.week_seconds-a.week_seconds).slice(0,5);return {generatedAt:new Date().toISOString(),summary:snap.summary,topAttendance:top.map(o=>({user_id:o.user_id,display_name:o.display_name,week_seconds:o.week_seconds,score:o.score.total})),inactive:snap.officers.filter(o=>o.inactive_days>=7).slice(0,20).map(o=>({user_id:o.user_id,display_name:o.display_name,inactive_days:o.inactive_days})),promotions:snap.officers.filter(o=>o.promotion_eligible).map(o=>({user_id:o.user_id,display_name:o.display_name,next_grade:o.next_grade,score:o.score.total}))};}
module.exports={getManagementSnapshot,getOfficerTimeline,audit,listAudit,getWeeklyReport};
