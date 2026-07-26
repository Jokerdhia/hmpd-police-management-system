const express=require("express");
const {getAttendanceSessions,getAttendanceActive,getAttendanceTotalsDashboard,getAttendanceDaily}=require("../dashboardDatabase");
const {listOfficers}=require("../services/officerService");
const {requireHighCommand,getModeratorId}=require("../auth/auth");
const {stopAttendance,removeAttendanceTime}=require("../../database");
const {sendChannelMessage}=require("../services/discordService");
const router=express.Router();
function getLogChannelId(){return String(process.env.ATTENDANCE_LOG_CHANNEL_ID||"").trim()}
function getRemarkChannelId(){return String(process.env.ATTENDANCE_REMARK_CHANNEL_ID||process.env.REMARK_CHANNEL_ID||"").trim()}
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
  res.json({success:true,summary:{active:active.filter(x=>!x.paused_at).length,paused:active.filter(x=>x.paused_at).length,offline:Math.max(officers.length-active.length,0),totalToday,totalWeek,totalMonth,officers:officers.length},officers:rows,active:activeRows,rankings:{day:day.slice(0,10).map(x=>enrich(x,map)),week:week.slice(0,10).map(x=>enrich(x,map)),month:month.slice(0,10).map(x=>enrich(x,map))},history:history.map(x=>enrich(x,map)),daily,permissions:{canForceStop:Boolean(req.session?.user?.isHighCommand)}});
}catch(e){next(e)}});
router.post("/:userId/force-stop",requireHighCommand,async(req,res,next)=>{try{
  const userId=String(req.params.userId||"").trim();if(!/^\d{16,22}$/.test(userId)){const e=new Error("Identifiant invalide.");e.status=400;e.publicMessage=e.message;throw e}
  const remark=String(req.body?.remark||"").trim();
  if(!remark||remark.length>500){const e=new Error("La remarque est obligatoire (500 caractères maximum).");e.status=400;e.publicMessage=e.message;throw e}
  const remarkChannelId=getRemarkChannelId();
  if(!remarkChannelId){const e=new Error("Le salon de remarques n’est pas configuré. Ajoute ATTENDANCE_REMARK_CHANNEL_ID dans Render puis redéploie le service.");e.status=503;e.publicMessage=e.message;throw e}
  const moderatorId=getModeratorId(req);const result=await stopAttendance(userId,moderatorId,"forced_by_dashboard");
  if(!result.stopped)return res.status(409).json({success:false,message:"Ce policier n'a plus de service actif."});
  const logChannelId=getLogChannelId();
  if(logChannelId){await sendChannelMessage(logChannelId,{embeds:[{color:10038562,title:"🛑 RAPPORT DE SERVICE — FIN FORCÉE",description:`👮 <@${userId}>`,fields:[{name:"🟢 Début",value:`<t:${Math.floor(new Date(result.session.started_at).getTime()/1000)}:F>`,inline:true},{name:"🔴 Fin",value:`<t:${Math.floor(new Date(result.session.ended_at).getTime()/1000)}:F>`,inline:true},{name:"⏱ Temps travaillé",value:`${Math.floor(Number(result.session.duration_seconds||0)/3600)} h ${Math.floor((Number(result.session.duration_seconds||0)%3600)/60)} min`,inline:true},{name:"☕ Pauses",value:`${Number(result.session.pause_count||0)} pause(s) — ${Math.floor(Number(result.session.paused_seconds||0)/60)} min`,inline:true},{name:"🛡 Action effectuée par",value:`<@${moderatorId}>`,inline:true},{name:"📝 Remarque",value:remark,inline:false}],footer:{text:"Harmony Police Department • Dashboard"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}}).catch(err=>console.error("Log fin forcée dashboard:",err.message))}
  let remarkSent=false;
  let remarkError=null;
  if(remarkChannelId){try{await sendChannelMessage(remarkChannelId,{content:`<@${userId}>`,embeds:[{color:15158332,title:"⚠️ REMARQUE — OUBLI DE FIN DE SERVICE",description:`<@${userId}>, une fin de service forcée a été effectuée car votre service n'a pas été correctement terminé.`,fields:[{name:"📝 Remarque du Haut Commandement",value:remark,inline:false},{name:"🛡 Remarque effectuée par",value:`<@${moderatorId}>`,inline:true},{name:"📅 Date",value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:true}],footer:{text:"Harmony Police Department • Merci de terminer correctement vos services"},timestamp:new Date().toISOString()}],allowed_mentions:{users:[userId,moderatorId],parse:[]}});remarkSent=true}catch(err){remarkError=err?.message||String(err);console.error("Envoi remarque fin forcée:",remarkError)}}
  res.json({success:true,message:remarkSent?"Fin de service forcée et remarque envoyée.":"La fin de service a été enregistrée, mais la remarque Discord n’a pas pu être envoyée. Vérifie l’ID du salon et les permissions du bot.",remarkSent,remarkError,session:result.session});
}catch(e){next(e)}});

router.post("/:userId/remove-time",requireHighCommand,async(req,res,next)=>{try{
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
  res.json({success:true,message:"Les heures ont été corrigées.",...result});
}catch(e){next(e)}});
module.exports=router;
