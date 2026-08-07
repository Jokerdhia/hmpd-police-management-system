const express=require("express");
const {getAttendanceSessions,getAttendanceActive,getAttendanceTotalsDashboard,getAttendanceDaily}=require("../dashboardDatabase");
const {listOfficers}=require("../services/officerService");
const {requireHighCommand,requireTargetNotHigher,getModeratorId}=require("../auth/auth");
const {startAttendance,stopAttendance,pauseAttendance,resumeAttendance,removeAttendanceTime}=require("../../database");
const {sendChannelMessage}=require("../services/discordService");
const {broadcast}=require("../services/realtimeService");
const router=express.Router();
function getLogChannelId(){return String(process.env.ATTENDANCE_LOG_CHANNEL_ID||"").trim()}
function getRemarkChannelId(){return String(process.env.ATTENDANCE_REMARK_CHANNEL_ID||process.env.REMARK_CHANNEL_ID||"").trim()}
function getForcedEndPenaltySeconds(){
  const raw=Number(process.env.FORCED_END_PENALTY_HOURS??5);
  const hours=Number.isFinite(raw)?Math.min(Math.max(raw,0),24):5;
  return Math.round(hours*3600);
}
function getForcedPausePenaltySeconds(){
  const raw=Number(process.env.FORCED_PAUSE_PENALTY_HOURS??1);
  const hours=Number.isFinite(raw)?Math.min(Math.max(raw,0),12):1;
  return Math.round(hours*3600);
}
function formatDurationAr(secondsValue){
  const total=Math.max(0,Number(secondsValue)||0),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60);
  if(hours&&minutes)return `${hours} ساعة و${minutes} دقيقة`;
  if(hours)return `${hours} ساعة`;
  return `${minutes} دقيقة`;
}
function seconds(v){return Math.max(0,Number(v)||0)}
function liveSeconds(s){const start=new Date(s.started_at).getTime();const end=s.paused_at?new Date(s.paused_at).getTime():Date.now();return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)-seconds(s.paused_seconds)):0}
function mapById(officers){return new Map((officers||[]).map(o=>[String(o.user_id),o]))}
function enrich(row,map){const o=map.get(String(row.user_id));return {...row,user_id:String(row.user_id),display_name:o?.display_name||o?.username||String(row.user_id),username:o?.username||String(row.user_id),avatar_url:o?.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png",grade:o?.grade||"Inconnu"}}
router.get("/overview",async(req,res,next)=>{try{
  const [officers,active,day,week,month,history,daily]=await Promise.all([listOfficers(),getAttendanceActive(),getAttendanceTotalsDashboard("day",200),getAttendanceTotalsDashboard("week",200),getAttendanceTotalsDashboard("month",200),getAttendanceSessions(100),getAttendanceDaily(7)]);
  const map=mapById(officers), dayMap=new Map(day.map(x=>[String(x.user_id),x])),weekMap=new Map(week.map(x=>[String(x.user_id),x])),monthMap=new Map(month.map(x=>[String(x.user_id),x]));
  const activeMap=new Map(active.map(x=>[String(x.user_id),x]));
  const rows=officers.map(o=>{const a=activeMap.get(String(o.user_id));return {...o,attendance_status:!a?"offline":a.paused_at?"paused":"active",session_seconds:a?liveSeconds(a):0,started_at:a?.started_at||null,paused_at:a?.paused_at||null,today_seconds:seconds(dayMap.get(String(o.user_id))?.total_seconds),week_seconds:seconds(weekMap.get(String(o.user_id))?.total_seconds),month_seconds:seconds(monthMap.get(String(o.user_id))?.total_seconds),week_sessions:Number(weekMap.get(String(o.user_id))?.sessions||0)}});
  const activeRows=active.map(x=>enrich({...x,session_seconds:liveSeconds(x)},map));
  const totalToday=day.reduce((a,x)=>a+seconds(x.total_seconds),0),totalWeek=week.reduce((a,x)=>a+seconds(x.total_seconds),0),totalMonth=month.reduce((a,x)=>a+seconds(x.total_seconds),0);
  res.json({success:true,summary:{active:active.filter(x=>!x.paused_at).length,paused:active.filter(x=>x.paused_at).length,offline:Math.max(officers.length-active.length,0),totalToday,totalWeek,totalMonth,officers:officers.length,forcedEndPenaltySeconds:getForcedEndPenaltySeconds(),forcedPausePenaltySeconds:getForcedPausePenaltySeconds()},officers:rows,active:activeRows,rankings:{day:day.slice(0,10).map(x=>enrich(x,map)),week:week.slice(0,10).map(x=>enrich(x,map)),month:month.slice(0,10).map(x=>enrich(x,map))},history:history.map(x=>enrich(x,map)),daily,permissions:{canForceStop:Boolean(req.session?.user?.isHighCommand)},currentUserId:String(req.session?.user?.id||"")});
}catch(e){next(e)}});

async function sendSelfLog(action,userId,result){
  const channelId=getLogChannelId();if(!channelId)return;
  const labels={start:["🟢 PRISE DE SERVICE",3066993],pause:["☕ MISE EN PAUSE",16753920],resume:["▶️ REPRISE DE SERVICE",3447003],stop:["🔴 FIN DE SERVICE",15158332]};
  const [title,color]=labels[action]||["PRÉSENCE",3447003];
  const fields=[{name:"👮 Policier",value:`<@${userId}>`,inline:true}];
  if(result?.session?.started_at)fields.push({name:"🕒 Début",value:`<t:${Math.floor(new Date(result.session.started_at).getTime()/1000)}:F>`,inline:true});
  if(action==="stop"&&result?.session){fields.push({name:"⏱ Temps travaillé",value:`${Math.floor(Number(result.session.duration_seconds||0)/3600)} h ${Math.floor((Number(result.session.duration_seconds||0)%3600)/60)} min`,inline:true});}
  await sendChannelMessage(channelId,{embeds:[{color,title,fields,footer:{text:"Harmony Police Department • Dashboard"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).catch(err=>console.error("Log présence personnelle:",err.message));
}
router.post("/me/:action",async(req,res,next)=>{try{
  const userId=String(req.session?.user?.id||"").trim();
  if(!/^\d{16,22}$/.test(userId))return res.status(401).json({success:false,message:"Session Discord invalide."});
  const action=String(req.params.action||"");let result;
  if(action==="start")result=await startAttendance(userId,userId);
  else if(action==="pause")result=await pauseAttendance(userId);
  else if(action==="resume")result=await resumeAttendance(userId);
  else if(action==="stop")result=await stopAttendance(userId,userId,"manual_dashboard");
  else return res.status(400).json({success:false,message:"Action invalide."});
  const ok=result.started||result.paused||result.resumed||result.stopped;
  if(!ok){const messages={already_active:"Tu es déjà en service.",already_paused:"Tu es déjà en pause.",not_paused:"Tu n’es pas en pause.",not_active:"Tu n’as aucun service actif."};return res.status(409).json({success:false,message:messages[result.reason]||"Action impossible."});}
  await sendSelfLog(action,userId,result);
  const messages={start:"Tu es maintenant en service.",pause:"Ta pause a été enregistrée.",resume:"Tu as repris ton service.",stop:"Ta fin de service a été enregistrée."};
  broadcast("attendance-changed",{userId,action});
  res.json({success:true,message:messages[action],session:result.session});
}catch(e){next(e)}});

router.post("/:userId/force-stop",requireHighCommand,requireTargetNotHigher('userId'),async(req,res,next)=>{try{
  const userId=String(req.params.userId||"").trim();if(!/^\d{16,22}$/.test(userId)){const e=new Error("Identifiant invalide.");e.status=400;e.publicMessage=e.message;throw e}
  const remark=String(req.body?.remark||"").trim();
  if(!remark||remark.length>500){const e=new Error("La remarque est obligatoire (500 caractères maximum).");e.status=400;e.publicMessage=e.message;throw e}
  const remarkChannelId=getRemarkChannelId();
  if(!remarkChannelId){const e=new Error("Le salon de remarques n’est pas configuré. Ajoute ATTENDANCE_REMARK_CHANNEL_ID dans Render puis redéploie le service.");e.status=503;e.publicMessage=e.message;throw e}
  const moderatorId=getModeratorId(req);const result=await stopAttendance(userId,moderatorId,"forced_by_dashboard");
  if(!result.stopped)return res.status(409).json({success:false,message:"Ce policier n'a plus de service actif."});
  const penaltyRequestedSeconds=getForcedEndPenaltySeconds();
  let penaltyRemovedSeconds=0,penaltyError=null;
  if(penaltyRequestedSeconds>0){
    try{
      const penalty=await removeAttendanceTime({userId,seconds:penaltyRequestedSeconds,reason:`Pénalité automatique — oubli de fin de service : ${remark}`,moderatorId});
      penaltyRemovedSeconds=Number(penalty.removedSeconds||0);
    }catch(err){
      if(Number(err?.status)!==409){penaltyError=err?.message||String(err);console.error("Pénalité fin forcée:",penaltyError)}
    }
  }
  const logChannelId=getLogChannelId();
  if(logChannelId){await sendChannelMessage(logChannelId,{embeds:[{color:10038562,title:"🛑 RAPPORT DE SERVICE — FIN FORCÉE",description:`👮 <@${userId}>`,fields:[{name:"🟢 Début",value:`<t:${Math.floor(new Date(result.session.started_at).getTime()/1000)}:F>`,inline:true},{name:"🔴 Fin",value:`<t:${Math.floor(new Date(result.session.ended_at).getTime()/1000)}:F>`,inline:true},{name:"⏱ Temps travaillé",value:`${Math.floor(Number(result.session.duration_seconds||0)/3600)} h ${Math.floor((Number(result.session.duration_seconds||0)%3600)/60)} min`,inline:true},{name:"☕ Pauses",value:`${Number(result.session.pause_count||0)} pause(s) — ${Math.floor(Number(result.session.paused_seconds||0)/60)} min`,inline:true},{name:"🛡 Action effectuée par",value:`<@${moderatorId}>`,inline:true},{name:"⏳ Pénalité appliquée",value:`− ${Math.floor(penaltyRemovedSeconds/3600)} h ${Math.floor((penaltyRemovedSeconds%3600)/60)} min`,inline:true},{name:"📝 Remarque",value:remark,inline:false}],footer:{text:"Harmony Police Department • Dashboard"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).catch(err=>console.error("Log fin forcée dashboard:",err.message))}
  let remarkSent=false;
  let remarkError=null;
  if(remarkChannelId){try{await sendChannelMessage(remarkChannelId,{content:`<@${userId}>`,embeds:[{color:15158332,title:"⚠️ تنبيه إداري",description:`تم إنهاء خدمة <@${userId}> إجبارياً بسبب عدم تسجيل نهاية الخدمة.`,fields:[{name:"⏳ خصم الساعات",value:penaltyRemovedSeconds>0?`تم خصم **${formatDurationAr(penaltyRemovedSeconds)}** من مجموع ساعاتك.`:"لم تتوفر ساعات كافية للخصم.",inline:false},{name:"📝 ملاحظة القيادة",value:remark,inline:false},{name:"🛡 بواسطة",value:`<@${moderatorId}>`,inline:true}],footer:{text:"Harmony Police • يرجى إنهاء الخدمة بشكل صحيح"}}],allowed_mentions:{parse:[],users:[String(userId)].filter(id=>/^\d{17,20}$/.test(id))}});remarkSent=true}catch(err){remarkError=err?.message||String(err);console.error("Envoi remarque fin forcée:",remarkError)}}
  const penaltyText=penaltyRemovedSeconds>0?`${Math.floor(penaltyRemovedSeconds/3600)} h ${Math.floor((penaltyRemovedSeconds%3600)/60)} min retirées`:"aucune heure disponible à retirer";
  broadcast("attendance-changed",{userId,action:"force-stop"});
  res.json({success:true,message:remarkSent?`Fin de service forcée, ${penaltyText}, et remarque envoyée.`:`La fin de service a été enregistrée (${penaltyText}), mais la remarque Discord n’a pas pu être envoyée.`,remarkSent,remarkError,penaltyRequestedSeconds,penaltyRemovedSeconds,penaltyError,session:result.session});
}catch(e){next(e)}});

router.post("/:userId/force-pause",requireHighCommand,requireTargetNotHigher('userId'),async(req,res,next)=>{try{
  const userId=String(req.params.userId||"").trim();
  if(!/^\d{16,22}$/.test(userId)){const e=new Error("Identifiant invalide.");e.status=400;e.publicMessage=e.message;throw e}
  const remark=String(req.body?.remark||"").trim();
  if(!remark||remark.length>500){const e=new Error("La remarque est obligatoire (500 caractères maximum).");e.status=400;e.publicMessage=e.message;throw e}
  const remarkChannelId=getRemarkChannelId();
  if(!remarkChannelId){const e=new Error("Le salon de remarques n’est pas configuré. Ajoute ATTENDANCE_REMARK_CHANNEL_ID dans Render puis redéploie le service.");e.status=503;e.publicMessage=e.message;throw e}
  const moderatorId=getModeratorId(req);
  const pauseResult=await pauseAttendance(userId);
  if(!pauseResult.paused){
    const message=pauseResult.reason==="already_paused"?"Ce policier est déjà en pause.":"Ce policier n’a pas de service actif.";
    return res.status(409).json({success:false,message});
  }
  const penaltyRequestedSeconds=getForcedPausePenaltySeconds();
  let penaltyRemovedSeconds=0,penaltyError=null;
  if(penaltyRequestedSeconds>0){
    try{
      const penalty=await removeAttendanceTime({userId,seconds:penaltyRequestedSeconds,reason:`Pénalité automatique — oubli de mise en pause : ${remark}`,moderatorId});
      penaltyRemovedSeconds=Number(penalty.removedSeconds||0);
    }catch(err){
      if(Number(err?.status)!==409){penaltyError=err?.message||String(err);console.error("Pénalité pause forcée:",penaltyError)}
    }
  }
  const logChannelId=getLogChannelId();
  if(logChannelId){await sendChannelMessage(logChannelId,{embeds:[{color:16753920,title:"☕ RAPPORT DE SERVICE — PAUSE FORCÉE",description:`👮 <@${userId}>`,fields:[{name:"⏳ Pénalité appliquée",value:`− ${Math.floor(penaltyRemovedSeconds/3600)} h ${Math.floor((penaltyRemovedSeconds%3600)/60)} min`,inline:true},{name:"📝 Motif",value:remark,inline:false},{name:"🛡 Action effectuée par",value:`<@${moderatorId}>`,inline:true}],footer:{text:"Harmony Police Department • Dashboard"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).catch(err=>console.error("Log pause forcée dashboard:",err.message))}
  let remarkSent=false,remarkError=null;
  try{
    await sendChannelMessage(remarkChannelId,{content:`<@${userId}>`,embeds:[{color:16753920,title:"☕ تنبيه إداري — استراحة إجبارية",description:`تم تغيير حالة <@${userId}> إلى **استراحة** بسبب عدم تسجيل الاستراحة.`,fields:[{name:"⏳ خصم الساعات",value:penaltyRemovedSeconds>0?`تم خصم **${formatDurationAr(penaltyRemovedSeconds)}** من مجموع ساعاتك.`:"لم تتوفر ساعات كافية للخصم.",inline:false},{name:"📝 ملاحظة القيادة",value:remark,inline:false},{name:"🛡 بواسطة",value:`<@${moderatorId}>`,inline:true}],footer:{text:"Harmony Police • يرجى تسجيل الاستراحة في الوقت المناسب"}}],allowed_mentions:{parse:[],users:[String(userId)].filter(id=>/^\d{17,20}$/.test(id))}});
    remarkSent=true;
  }catch(err){remarkError=err?.message||String(err);console.error("Envoi remarque pause forcée:",remarkError)}
  broadcast("attendance-changed",{userId,action:"force-pause"});
  res.json({success:true,message:remarkSent?"Le policier a été mis en pause, la pénalité a été appliquée et la remarque envoyée.":"Le policier a été mis en pause, mais la remarque Discord n’a pas pu être envoyée.",remarkSent,remarkError,penaltyRequestedSeconds,penaltyRemovedSeconds,penaltyError,session:pauseResult.session});
}catch(e){next(e)}});

router.post("/:userId/remove-time",requireHighCommand,requireTargetNotHigher('userId'),async(req,res,next)=>{try{
  const userId=String(req.params.userId||"").trim();
  if(!/^\d{16,22}$/.test(userId)){const e=new Error("Identifiant invalide.");e.status=400;e.publicMessage=e.message;throw e}
  const hours=Number(req.body?.hours||0),minutes=Number(req.body?.minutes||0);
  if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||minutes<0||minutes>59||(hours===0&&minutes===0)||hours>744){const e=new Error("Indique une durée valide à retirer.");e.status=400;e.publicMessage=e.message;throw e}
  const reason=String(req.body?.reason||"").trim();
  if(!reason||reason.length>500){const e=new Error("Le motif est obligatoire (500 caractères maximum).");e.status=400;e.publicMessage=e.message;throw e}
  const moderatorId=getModeratorId(req);
  const result=await removeAttendanceTime({userId,seconds:(hours*3600)+(minutes*60),reason,moderatorId});
  const logChannelId=getLogChannelId();
  if(logChannelId){await sendChannelMessage(logChannelId,{embeds:[{color:15158332,title:"⏱ CORRECTION DES HEURES",description:`👮 <@${userId}>`,fields:[{name:"Temps retiré",value:`${Math.floor(result.removedSeconds/3600)} h ${Math.floor((result.removedSeconds%3600)/60)} min`,inline:true},{name:"Motif",value:reason,inline:false},{name:"Action effectuée par",value:`<@${moderatorId}>`,inline:true}],footer:{text:"Harmony Police Department • Dashboard"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).catch(err=>console.error("Log correction heures:",err.message))}
  broadcast("attendance-changed",{userId,action:"adjust"});
  res.json({success:true,message:"Les heures ont été corrigées.",...result});
}catch(e){next(e)}});
module.exports=router;
