(()=>{
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dur=s=>`${Math.floor(Number(s||0)/3600)}h ${String(Math.floor(Number(s||0)%3600/60)).padStart(2,'0')}m`;
  const dt=v=>v?new Date(v).toLocaleString('fr-FR'):'Jamais';
  let data=null,promotions=[],permissions={},promoFilter='eligible',promoPageFilter='all',promoSearch='',promoPage=1,promoPageSize=12,selectedPromotionUser=null,managementTimer=null,notifyTimer=null;

  async function req(url,options={}){
    const init={cache:'no-store',...options};
    if(init.body&&typeof init.body!=='string'){
      init.headers={...(init.headers||{}),'Content-Type':'application/json','Idempotency-Key':`${Date.now()}-${Math.random()}`};
      init.body=JSON.stringify(init.body);
    }
    const r=await fetch(url,init),d=await r.json().catch(()=>null);
    if(!r.ok||!d?.success)throw new Error(d?.message||`Service indisponible (${r.status||'réseau'})`);
    return d;
  }
  function notify(msg,ok=true){
    const n=$('#notification'); if(!n)return alert(msg);
    if(notifyTimer)clearTimeout(notifyTimer);
    n.textContent=msg;n.className=`toast ${ok?'success':'error'}`;
    notifyTimer=setTimeout(()=>n.classList.add('hidden'),4500);
  }
  function clearError(){const n=$('#notification');if(n?.classList.contains('error'))n.classList.add('hidden')}
  function activityIcon(type){return {points:'⭐',attendance_start:'🟢',attendance_end:'⏹️',sanction:'⚠️',audit:'🧾'}[type]||'•'}
  function activityValue(a){if(a.type==='points'&&Number(a.value))return `<strong class="${Number(a.value)>0?'positive':'negative'}">${Number(a.value)>0?'+':''}${Number(a.value)}</strong>`;if(a.type==='attendance_end'&&Number(a.value)>0)return `<strong>${dur(a.value)}</strong>`;return ''}
  function renderRecentActivity(){
    const box=$('#managementRecentActivity');if(!box)return;
    const rows=data?.recentActivity||[];
    box.innerHTML=rows.map(a=>`<div class="command-activity-row"><span class="command-activity-icon">${activityIcon(a.type)}</span><div class="command-activity-main"><strong>${esc(a.display_name||a.user_id||'Système')}</strong><span>${esc(a.title||'Activité')}</span><small>${esc(a.detail||'')}</small></div><div class="command-activity-side">${activityValue(a)}<time>${dt(a.created_at)}</time></div></div>`).join('')||'<div class="empty">Aucune activité récente.</div>';
    const last=$('#managementLastUpdate');if(last)last.textContent=`Mis à jour ${new Date(data?.generatedAt||Date.now()).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  }
  function scoreBar(o){return `<div class="score-cell"><strong>${o.score.total}/100</strong><div class="score-track"><i style="width:${o.score.total}%"></i></div><small>${esc(o.score.label)}</small></div>`}
  function statusMeta(status){
    return {
      progress:['🟡','En progression'],eligible:['🟢','Éligible'],evaluation:['🔵','En évaluation'],approved:['🟣','Approuvée'],rejected:['🔴','Refusée'],postponed:['🟠','Reportée'],frozen:['🔒','Gelée']
    }[status]||['⚪',status||'Inconnu'];
  }
  function promotionProgress(p){
    if(!p?.progress)return '';
    const m=statusMeta(p.status),pct=Number(p.progress.percent||0);
    return `<div class="promo-card-progress"><div><span>${m[0]} ${esc(m[1])}</span><strong>${pct}%</strong></div><div class="promo-track"><i style="width:${pct}%"></i></div></div>`;
  }
  function statusCounts(){
    const count=status=>promotions.filter(p=>p.status===status).length;
    return {all:promotions.length,progress:count('progress'),eligible:count('eligible'),evaluation:count('evaluation'),frozen:count('frozen'),postponed:count('postponed')};
  }
  function careerCard(p){
    const m=statusMeta(p.status),pct=Number(p.progress?.percent||0),done=Number(p.progress?.completed||0),total=Number(p.progress?.total||0),days=Math.min(Number(p.progress?.daysInRank||0),Number(p.progress?.minDays||0)),sanctions=Number(p.progress?.activeSanctions||0),points=Number(p.progress?.currentPoints??p.points??0),requiredPoints=Number(p.progress?.requiredPoints||0);
    return `<button class="career-card status-${esc(p.status)}" data-promotion-user="${p.user_id}">
      <div class="career-top"><img class="career-avatar" src="${esc(p.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt=""><div class="career-id"><strong>${esc(p.display_name||p.user_id)}</strong><span>${esc(p.grade)} → ${esc(p.to_grade)}</span></div><span class="career-status">${m[0]} ${esc(m[1])}</span></div>
      <div class="career-meta"><span>Points <b>${points}/${requiredPoints}</b></span><span>Critères <b>${done}/${total}</b></span><span>Présence <b>${days}/${Number(p.progress?.minDays||0)} j</b></span><span>Discipline <b>${sanctions?`⚠ ${sanctions}`:'RAS'}</b></span></div>
      <div class="career-track"><i style="width:${pct}%"></i></div><div class="career-foot"><span>Progression du dossier</span><strong>${pct}%</strong></div>
    </button>`;
  }
  function renderPromotions(){
    const compact=$('#managementPromotions');
    if(compact){
      const list=promotions.filter(p=>p.status===promoFilter).slice(0,10);
      compact.innerHTML=list.map(p=>`<button class="management-row promotion-row status-${esc(p.status)}" data-promotion-user="${p.user_id}"><img class="promo-avatar" src="${esc(p.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt=""><div class="promo-main"><strong>${esc(p.display_name||p.user_id)}</strong><p>${esc(p.grade)} → ${esc(p.to_grade)}${p.evaluation?` · RP ${p.evaluation.score}/100`:''}</p>${promotionProgress(p)}</div></button>`).join('')||'<div class="empty">Aucun dossier nécessitant une décision.</div>';
    }
    const counts=statusCounts();
    if($('#mgPromotions'))$('#mgPromotions').textContent=counts.eligible;
    [['#promoTotal',counts.all],['#promoEligible',counts.eligible],['#promoEvaluation',counts.evaluation],['#promoFrozen',counts.frozen],['#promoCountAll',counts.all],['#promoCountProgress',counts.progress],['#promoCountEligible',counts.eligible],['#promoCountEvaluation',counts.evaluation],['#promoCountFrozen',counts.frozen]].forEach(([id,v])=>{const el=$(id);if(el)el.textContent=v});
    const center=$('#promotionCenterList');
    if(center){
      const q=promoSearch.toLowerCase();
      const list=promotions.filter(p=>(promoPageFilter==='all'||p.status===promoPageFilter)&&(!q||[p.display_name,p.user_id,p.grade,p.to_grade].some(v=>String(v||'').toLowerCase().includes(q))));
      const pages=Math.max(1,Math.ceil(list.length/promoPageSize));
      promoPage=Math.min(Math.max(1,promoPage),pages);
      const start=(promoPage-1)*promoPageSize;
      const visible=list.slice(start,start+promoPageSize);
      center.innerHTML=visible.map(careerCard).join('')||'<div class="empty">Aucun dossier ne correspond à ce filtre.</div>';
      const info=$('#promotionPageInfo'),prev=$('#promotionPrevPage'),next=$('#promotionNextPage');
      if(info)info.textContent=`Page ${promoPage} / ${pages} · ${list.length} dossier(s)`;
      if(prev)prev.disabled=promoPage<=1;
      if(next)next.disabled=promoPage>=pages;
    }
    window.updatePromotionBadges?.(promotions);
  }
  function render(filter=''){
    if(!data)return;const q=filter.toLowerCase();
    $('#mgOnDuty').textContent=data.summary.onDuty;
    $('#mgAverageScore').textContent=data.summary.averageScore+'/100';
    $('#mgInactive').textContent=data.summary.inactive7;if($('#mgExcellent'))$('#mgExcellent').textContent=data.summary.excellent||0;if($('#mgAttention'))$('#mgAttention').textContent=data.summary.needsAttention||0;
    $('#managementAlerts').innerHTML=data.alerts.map(a=>{const o=data.officers.find(x=>x.user_id===a.user_id);return `<button class="management-row severity-${a.severity}" data-mg-profile="${a.user_id}"><span>${a.severity==='high'?'🔴':a.severity==='medium'?'🟠':'🔵'}</span><div><strong>${esc(o?.display_name||a.user_id)}</strong><p>${esc(a.message)}</p></div></button>`}).join('')||'<div class="empty">Aucune alerte.</div>';
    renderRecentActivity();
    const cov=$('#coverageGrid');if(cov)cov.innerHTML=(data.coverage||[]).map(x=>`<div class="coverage-hour ${x.officers===0?'coverage-empty':x.officers<=2?'coverage-low':''}"><strong>${String(x.hour).padStart(2,'0')}h</strong><span>${x.officers}</span></div>`).join('');
    const list=data.officers.filter(o=>!q||String(o.display_name||'').toLowerCase().includes(q)||String(o.grade||'').toLowerCase().includes(q)||o.user_id.includes(q));
    $('#managementOfficerRows').innerHTML=list.map(o=>`<tr><td><strong>${esc(o.display_name||o.user_id)}</strong><small class="table-sub">${o.user_id}</small></td><td><span class="grade-pill">${esc(o.grade)}</span></td><td>${scoreBar(o)}</td><td>${dur(o.week_seconds)}</td><td>${o.active_sanctions?`⚠️ ${o.active_sanctions} sanction(s)`:'✅ RAS'}</td><td>${o.inactive_days===999?'Jamais':o.inactive_days+' j'}</td><td><button class="profile-button" data-promotion-user="${o.user_id}">Promotion</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">Aucun résultat.</div></td></tr>';
  }
  function reportText(r){return [`RAPPORT HEBDOMADAIRE HMPD`,`Généré : ${new Date(r.generatedAt).toLocaleString('fr-FR')}`,``,`Effectif : ${r.summary.officers} | En service : ${r.summary.onDuty} | Score moyen : ${r.summary.averageScore}/100`,`Dossiers éligibles : ${promotions.filter(p=>p.status==='eligible').length} | Inactifs 7j+ : ${r.summary.inactive7}`,``,`TOP PRÉSENCE`,...r.topAttendance.map((o,i)=>`${i+1}. ${o.display_name||o.user_id} — ${dur(o.week_seconds)} — score ${o.score}/100`),``,`PROMOTIONS ÉLIGIBLES`,...(promotions.filter(p=>p.status==='eligible').length?promotions.filter(p=>p.status==='eligible').map(p=>`• ${p.display_name||p.user_id} → ${p.to_grade} (${p.progress.percent}%)`):['• Aucune']),``,`INACTIFS`,...(r.inactive.length?r.inactive.map(o=>`• ${o.display_name||o.user_id} — ${o.inactive_days} jours`):['• Aucun'])].join('\n')}

  async function load({silent=false}={}){
    const refresh=$('#managementRefresh');if(refresh)refresh.disabled=true;
    try{
      const results=await Promise.allSettled([req('/api/management/overview'),req('/api/management/audit?limit=50'),req('/api/management/weekly-report'),req('/api/promotions')]);
      const [ovR,auditR,repR,proR]=results;
      if(ovR.status!=='fulfilled')throw ovR.reason;
      data=ovR.value;
      if(proR.status==='fulfilled')promotions=proR.value.promotions||[];
      render($('#managementSearch')?.value||'');renderPromotions();clearError();
      if(repR.status==='fulfilled')$('#weeklyReport').textContent=reportText(repR.value.report);
      else if($('#weeklyReport'))$('#weeklyReport').textContent='Rapport temporairement indisponible — les données principales restent actives.';
      if(auditR.status==='fulfilled')$('#managementAudit').innerHTML=auditR.value.audit.map(x=>`<div class="management-row static"><span>🧾</span><div><strong>${esc(x.action)}</strong><p>${esc(x.actor_id)} → ${esc(x.target_id||'système')} · ${dt(x.created_at)}</p></div></div>`).join('')||'<div class="empty">Aucun audit.</div>';
      else if($('#managementAudit'))$('#managementAudit').innerHTML='<div class="empty">Audit temporairement indisponible.</div>';
      const optionalFailed=results.slice(1).filter(x=>x.status==='rejected').length;
      if(optionalFailed&&!silent)console.warn(`Command Center: ${optionalFailed} module(s) secondaire(s) indisponible(s).`);
    }catch(e){
      if(!silent)notify(`Centre de commandement indisponible : ${e.message}`,false);
      else console.warn('Actualisation automatique impossible :',e.message);
    }finally{if(refresh)refresh.disabled=false}
  }
  function startManagementAutoRefresh(){
    if(managementTimer)clearInterval(managementTimer);
    managementTimer=setInterval(()=>{if($('#managementPage')?.classList.contains('active'))load({silent:true})},30000);
  }

  async function timeline(id){
    try{const r=await req(`/api/management/officers/${id}/timeline?limit=80`);const o=data?.officers.find(x=>x.user_id===id);const html=`<div class="mg-profile"><h3>${esc(o?.display_name||id)}</h3>${o?scoreBar(o):''}<div class="timeline-list">${r.timeline.map(x=>`<div class="timeline-item"><time>${dt(x.created_at)}</time><div><strong>${esc(x.title)}</strong><p>${esc(x.detail||'')}</p></div></div>`).join('')||'<div class="empty">Aucun événement.</div>'}</div></div>`;const modal=$('#profileModal');$('#profileContent').innerHTML=html;modal?.classList.remove('hidden')}catch(e){notify(e.message,false)}
  }

  function stars(name,value=5){return `<label class="rp-rating"><span>${name}</span><select data-rp-rating="${name}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===value?'selected':''}>${n} / 5</option>`).join('')}</select></label>`}
  async function openPromotion(id){
    try{
      selectedPromotionUser=id;const r=await req(`/api/promotions/${id}`);const p=r.promotion;if(!p?.case){notify('Aucune promotion disponible pour ce grade.',false);return}
      const o=p.officer,m=statusMeta(p.case.status),progress=p.progress||{},canModifyTarget=p.target_access?.canModifyTarget!==false;
      $('#promotionModalTitle').textContent=`${o.display_name||id} — ${p.case.from_grade} → ${p.case.to_grade}`;
      $('#promotionModalSubtitle').textContent=p.requirement?.appointmentOnly?'Nomination High Command':'Dossier officiel de progression';
      const evalBlock=p.evaluation?`<div class="promo-eval-summary"><div><span>Dernière évaluation RP</span><strong>${p.evaluation.score}/100</strong></div><small>Évalué le ${dt(p.evaluation.created_at)} par ${esc(p.evaluation.evaluator_id)}</small></div>`:'<div class="promo-eval-summary"><div><span>Évaluation RP</span><strong>Non évalué</strong></div></div>';
      const pointsCondition=`<div class="promo-condition ${progress.pointsOk?'done':'pending'}"><span>${progress.pointsOk?'✅':'⭐'}</span><div><strong>Points requis pour ${esc(p.case.to_grade)}</strong><p><b>${Number(progress.currentPoints||0)} / ${Number(progress.requiredPoints||0)} points</b>${progress.pointsRemaining?` · encore ${Number(progress.pointsRemaining)} point(s)`:' · seuil atteint'}</p><div class="promo-track"><i style="width:${Number(progress.pointProgressPercent||0)}%"></i></div></div></div>`;
      const presenceCondition=p.requirement?.appointmentOnly?'':`<div class="promo-condition ${progress.daysOk?'done':'pending'}"><span>${progress.daysOk?'✅':'❌'}</span><div><strong>Journées de présence validées</strong><p>${Math.min(Number(progress.daysInRank||0),Number(progress.minDays||0))}/${progress.minDays} jours · minimum ${dur(progress.minDailySeconds||7200)} par journée</p></div></div>`;
      const general=`<div class="promo-general-grid">${pointsCondition}${presenceCondition}<div class="promo-condition ${progress.disciplineOk?'done':'blocked'}"><span>${progress.disciplineOk?'✅':'🔒'}</span><div><strong>Discipline</strong><p>${progress.activeSanctions?`${progress.activeSanctions} sanction(s) active(s)`:'Aucune sanction active'}</p></div></div></div>`;
      const dailyAttendance=(progress.dailyAttendance||[]).filter(d=>Number(d.seconds||0)>0).map(d=>`<div class="attendance-day ${d.qualified?'qualified':'unqualified'}"><span>${d.qualified?'✅':'❌'} ${new Date(`${String(d.day).slice(0,10)}T12:00:00`).toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})}</span><strong>${dur(d.seconds)}</strong></div>`).join('');
      const remainingDays=Math.max(0,Number(progress.minDays||0)-Number(progress.daysInRank||0));
      const attendanceBlock=p.requirement?.appointmentOnly?'':`<section class="promo-section"><div class="promo-section-head"><div><h3>📅 Présence requise — cumul depuis la prise de grade</h3><p>Chaque journée atteint <strong>${dur(progress.minDailySeconds||7200)}</strong> = <strong>+1 jour validé</strong>. Les sessions du même jour s'additionnent. Les 7 journées <strong>n'ont pas besoin d'être consécutives ni dans la même semaine</strong>.</p></div><strong>${Math.min(Number(progress.daysInRank||0),Number(progress.minDays||0))}/${progress.minDays} jours validés${remainingDays?` · ${remainingDays} restant(s)`:' · ✅ objectif atteint'}</strong></div><div class="attendance-day-grid">${dailyAttendance||'<div class="empty">Aucune journée travaillée enregistrée depuis la prise de grade.</div>'}</div></section>`;
      const criteria=(progress.criteria||[]).map(c=>`<label class="promotion-criterion ${c.completed?'complete':''}"><input type="checkbox" data-criterion-key="${esc(c.key)}" ${c.completed?'checked':''} ${permissions.canManagePromotions&&canModifyTarget?'':'disabled'}><span><strong>${esc(c.label)}</strong>${c.note?`<small>${esc(c.note)}</small>`:''}</span></label>`).join('');
      const reopen=['postponed','rejected'].includes(p.case.status)?'<button class="btn btn-secondary" data-promo-action="progress">↩️ Réouvrir le dossier</button>':'';
      const statusActions=permissions.canManagePromotions&&canModifyTarget?`<div class="promo-actions">${reopen}<button class="btn btn-secondary" data-promo-action="evaluation" ${!progress.eligible?'disabled':''}>🔵 Mettre en évaluation</button><button class="btn btn-secondary" data-promo-action="postponed">⏳ Reporter</button><button class="btn btn-danger" data-promo-action="rejected">❌ Refuser</button>${permissions.canApprovePromotions?(progress.eligible||progress.appointmentOnly?`<button class="btn btn-primary promo-approve" data-promo-action="approve">✅ Approuver la promotion</button>`:`<button class="btn btn-danger promo-approve" data-promo-action="force-approve">⚡ Forcer la promotion</button>`):''}</div>`:'<div class="permission-note">🔐 Décision réservée au rôle High Grade.</div>';
      const sanctions=(p.sanctions||[]).map(x=>`<div class="sanction-row ${x.status==='active'?'active':''}"><div><strong>⚠️ ${esc(x.sanction_type)}</strong><p>${esc(x.reason)} · ${dt(x.created_at)}</p></div><div class="sanction-actions"><span>${esc(x.status)}</span>${permissions.canSanction&&canModifyTarget&&x.status==='active'?`<button class="btn btn-secondary" data-sanction-status="expired" data-sanction-id="${x.id}">Clôturer</button>`:''}${permissions.canSanction&&canModifyTarget?`<button class="btn btn-danger" data-sanction-delete="${x.id}">Supprimer</button>`:''}</div></div>`).join('')||'<div class="empty">Aucune sanction.</div>';
      const c=progress.components||{};
      const componentCards=`<section class="promo-overview"><div class="promo-overview-card ${c.points?.ok?'ok':'warn'}"><span class="promo-overview-icon">⭐</span><div><small>POINTS</small><strong>${c.points?.done||0} / ${c.points?.total||0}</strong><p>${c.points?.ok?'Seuil atteint':`${c.points?.remaining||0} point(s) restant(s)`}</p></div></div><div class="promo-overview-card ${c.presence?.ok?'ok':'warn'}"><span class="promo-overview-icon">📅</span><div><small>PRÉSENCE</small><strong>${c.presence?.done||0} / ${c.presence?.total||0}</strong><p>${c.presence?.ok?'Objectif atteint':'Journées validées'}</p></div></div><div class="promo-overview-card ${c.criteria?.ok?'ok':'warn'}"><span class="promo-overview-icon">📋</span><div><small>CRITÈRES</small><strong>${c.criteria?.done||0} / ${c.criteria?.total||0}</strong><p>${c.criteria?.ok?'Tous validés':'Vérification requise'}</p></div></div><div class="promo-overview-card ${c.discipline?.ok?'ok':'danger'}"><span class="promo-overview-icon">🛡️</span><div><small>DISCIPLINE</small><strong>${c.discipline?.ok?'RAS':'BLOQUÉE'}</strong><p>${c.discipline?.ok?'Aucune sanction active':`${progress.activeSanctions||0} sanction(s) active(s)`}</p></div></div></section>`;
      const badgeBlock=(p.badges||[]).length?`<section class="promo-section promo-section-compact"><div class="promo-section-head"><div><span class="promo-section-kicker">RECONNAISSANCE</span><h3>Badges internes</h3><p>Récompenses de performance internes, sans promotion automatique.</p></div></div><div class="badge-wall">${p.badges.map(b=>`<span class="career-badge"><b>${b.icon}</b>${esc(b.label)}</span>`).join('')}</div></section>`:'';
      const personalStats=`<section class="promo-section promo-section-compact"><div class="promo-section-head"><div><span class="promo-section-kicker">ACTIVITÉ</span><h3>Statistiques de service</h3><p>Résumé des présences et du temps de service enregistré.</p></div></div><div class="promo-stats-grid"><div class="promo-stat"><span>Jours qualifiés</span><strong>${Math.min(Number(progress.daysInRank||0),Number(progress.minDays||0))} / ${progress.minDays||0}</strong></div><div class="promo-stat"><span>Cette semaine</span><strong>${dur(p.serviceStats?.week_seconds||0)}</strong></div><div class="promo-stat"><span>Ce mois</span><strong>${dur(p.serviceStats?.month_seconds||0)}</strong></div><div class="promo-stat"><span>Statut dossier</span><strong>${esc(m[1])}</strong></div></div></section>`;
      const evaluationHistory=(p.evaluations||[]).length?`<div class="evaluation-history"><h4>Évaluations récentes</h4>${p.evaluations.slice(0,6).map(e=>`<div class="evaluation-history-row"><strong>${e.score}/100</strong><span>${dt(e.created_at)} · ${esc(e.evaluator_id)}</span><small>${esc(e.comment||'Sans commentaire')}</small></div>`).join('')}</div>`:'';
      const sanctionCreate=permissions.canSanction&&canModifyTarget?`<div class="sanction-create"><div class="sanction-create-grid"><select id="sanctionType"><option>Avertissement oral</option><option selected>Avertissement écrit</option><option>Strike</option><option>Suspension</option><option>Rétrogradation</option><option>Violation RP majeure</option></select><input id="sanctionExpiry" type="datetime-local" title="Expiration optionnelle"><button class="btn btn-danger" id="addSanctionButton">⚠️ Ajouter la sanction</button></div><textarea id="sanctionReason" placeholder="Motif de la sanction..."></textarea></div>`:'<div class="permission-note">🔐 Gestion des sanctions réservée au rôle High Grade.</div>';
      const evaluationForm=permissions.canEvaluate&&canModifyTarget?`<div class="rp-grid">${stars('professionalism')}${stars('procedures')}${stars('radio')}${stars('teamwork')}${stars('reports')}${stars('responsiveness')}${stars('hierarchy')}</div><textarea id="rpEvaluationComment" placeholder="Commentaire de l’évaluateur..."></textarea><button class="btn btn-secondary" id="saveRpEvaluation">Enregistrer l’évaluation hebdomadaire</button>`:'<div class="permission-note">🔐 Évaluation réservée au rôle High Grade.</div>';
      const hierarchyNotice=!canModifyTarget?`<div class="permission-note">${p.target_access?.isSelf?'🚫 Auto-modification interdite : ton propre dossier est en lecture seule. Un autre High Grade autorisé doit intervenir.':`🔒 Lecture seule : ${esc(p.target_access?.targetGrade||p.case.from_grade)} est supérieur à ton grade ${esc(p.target_access?.actorGrade||'non défini')}. Aucune modification n’est autorisée.`}</div>`:'';
      $('#promotionModalContent').innerHTML=`${hierarchyNotice}<div class="promotion-header-card pro"><div class="promo-identity"><img src="${esc(o.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt=""><div><span class="promo-section-kicker">DOSSIER DE PROMOTION</span><strong>${esc(o.display_name||id)}</strong><span>${esc(p.case.from_grade)} <b>→</b> ${esc(p.case.to_grade)}</span></div></div><div class="promo-status status-${esc(p.case.status)}">${m[0]} ${esc(m[1])}</div><div class="promo-percent"><strong>${progress.percent||0}%</strong><span>${progress.completed||0} / ${progress.total||0} critères</span></div></div><div class="promo-progress-wrap"><div><span>Progression globale</span><strong>${progress.percent||0}%</strong></div><div class="promo-track large"><i style="width:${progress.percent||0}%"></i></div></div>${componentCards}<div class="promo-two-col">${personalStats}${badgeBlock}</div><section class="promo-section"><div class="promo-section-head"><div><span class="promo-section-kicker">CONDITIONS AUTOMATIQUES</span><h3>Éligibilité générale</h3><p>Vérification automatique des points, de la présence et de la discipline.</p></div></div>${general}</section>${attendanceBlock}<section class="promo-section"><div class="promo-section-head"><div><span class="promo-section-kicker">VALIDATION HIGH COMMAND</span><h3>متطلبات الترقية · Critères de promotion</h3><p>Chaque critère doit être vérifié avant validation.</p></div><strong class="promo-section-counter">${progress.completed||0} / ${progress.total||0}</strong></div><div class="promotion-criteria">${criteria}</div></section><section class="promo-section"><div class="promo-section-head"><div><span class="promo-section-kicker">ÉVALUATION</span><h3>RP Quality</h3><p>Évaluation professionnelle sur 5 pour chaque compétence.</p></div></div>${evalBlock}${evaluationForm}${evaluationHistory}</section><section class="promo-section"><div class="promo-section-head"><div><span class="promo-section-kicker">DISCIPLINE</span><h3>Sanctions et restrictions</h3><p>Une sanction active bloque automatiquement la promotion.</p></div></div>${sanctionCreate}<div class="sanction-list">${sanctions}</div></section><section class="promo-section promo-decision-section"><div class="promo-section-head"><div><span class="promo-section-kicker">DÉCISION FINALE</span><h3>Validation High Command</h3><p>La décision est journalisée et réservée aux membres autorisés.</p></div></div><textarea id="promotionDecisionReason" placeholder="Ajouter un motif ou un commentaire de décision..."></textarea>${statusActions}</section>${p.history?.length?`<section class="promo-section"><div class="promo-section-head"><div><span class="promo-section-kicker">HISTORIQUE</span><h3>Évolution des grades</h3></div></div><div class="timeline-list">${p.history.map(h=>`<div class="timeline-item"><time>${dt(h.created_at)}</time><div><strong>${esc(h.from_grade||'—')} → ${esc(h.to_grade)}</strong><p>${esc(h.reason||h.action||'')}</p></div></div>`).join('')}</div></section>`:''}`;
      $('#promotionModal').classList.remove('hidden');
    }catch(e){notify(e.message,false)}
  }
  window.openPromotionCase=openPromotion;
  window.getPromotionCenterData=()=>promotions;
  function closePromotion(){$('#promotionModal')?.classList.add('hidden');selectedPromotionUser=null}
  async function updateCriterion(input){
    const key=input.dataset.criterionKey; input.disabled=true;
    try{await req(`/api/promotions/${selectedPromotionUser}/criteria/${encodeURIComponent(key)}`,{method:'POST',body:{completed:input.checked}});await openPromotion(selectedPromotionUser);await load()}catch(e){input.checked=!input.checked;notify(e.message,false)}finally{input.disabled=false}
  }
  async function saveEvaluation(){
    const ratings={};$$('[data-rp-rating]').forEach(s=>ratings[s.dataset.rpRating]=Number(s.value));
    try{await req(`/api/promotions/${selectedPromotionUser}/evaluations`,{method:'POST',body:{ratings,comment:$('#rpEvaluationComment')?.value||''}});notify('Évaluation RP enregistrée.');await openPromotion(selectedPromotionUser);await load()}catch(e){notify(e.message,false)}
  }
  async function promotionAction(action){
    const reason=$('#promotionDecisionReason')?.value?.trim()||'';
    try{
      if(action==='force-approve'){
        if(reason.length<3){notify('Un motif est obligatoire pour forcer une promotion.',false);return}
        if(!confirm('Forcer cette promotion malgré les conditions non remplies ? Cette action sera enregistrée dans l’audit.'))return;
        await req(`/api/promotions/${selectedPromotionUser}/approve`,{method:'POST',body:{reason,force:true}});
        notify('Promotion forcée et rôle Discord mis à jour.');
      }else if(action==='approve'){
        await req(`/api/promotions/${selectedPromotionUser}/approve`,{method:'POST',body:{reason,force:false}});
        notify('Promotion approuvée et rôle Discord mis à jour.');
      }else{
        await req(`/api/promotions/${selectedPromotionUser}/status`,{method:'POST',body:{status:action,reason}});
        notify('Dossier mis à jour.');
      }
      await load();await openPromotion(selectedPromotionUser);
    }catch(e){notify(e.message,false)}
  }

  async function addSanction(){
    const reason=$('#sanctionReason')?.value?.trim()||'';
    if(reason.length<3){notify('Ajoute un motif de sanction.',false);return}
    try{
      await req(`/api/officers/${selectedPromotionUser}/sanctions`,{method:'POST',body:{type:$('#sanctionType')?.value||'Avertissement écrit',reason,expiresAt:$('#sanctionExpiry')?.value||null}});
      notify('Sanction enregistrée. La promotion est gelée si elle est active.');await openPromotion(selectedPromotionUser);await load();
    }catch(e){notify(e.message,false)}
  }
  async function sanctionStatus(id,status){try{await req(`/api/officers/${selectedPromotionUser}/sanctions/${id}`,{method:'PATCH',body:{status}});notify('Sanction mise à jour.');await openPromotion(selectedPromotionUser);await load()}catch(e){notify(e.message,false)}}
  async function deleteSanctionAction(id){if(!confirm('Supprimer définitivement cette sanction ?'))return;try{await req(`/api/officers/${selectedPromotionUser}/sanctions/${id}`,{method:'DELETE'});notify('Sanction supprimée.');await openPromotion(selectedPromotionUser);await load()}catch(e){notify(e.message,false)}}

  async function init(){
    try{
      const me=await req('/api/me');permissions=me.permissions||{};
      const nav=$('#managementNav');if(permissions.canViewCommandCenter)nav?.classList.remove('hidden');nav?.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));nav.classList.add('active');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$('#managementPage')?.classList.add('active');$('#pageTitle').textContent='Centre de commandement';$('#pageSubtitle').textContent='Performance, alertes et audit High Command';load()});
      const promoNav=$('#promotionsNav');if(permissions.canManagePromotions)promoNav?.classList.remove('hidden');promoNav?.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));promoNav.classList.add('active');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$('#promotionsPage')?.classList.add('active');$('#pageTitle').textContent='Promotions';$('#pageSubtitle').textContent='Dossiers de carrière et validation High Command';load()});
      $('#managementRefresh')?.addEventListener('click',load);$('#promotionsRefresh')?.addEventListener('click',load);$('#managementSearch')?.addEventListener('input',e=>render(e.target.value));$('#copyWeeklyReport')?.addEventListener('click',()=>navigator.clipboard?.writeText($('#weeklyReport').textContent));
      $('#commandTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-command-tab]');if(!b)return;const tab=b.dataset.commandTab;$$('#commandTabs [data-command-tab]').forEach(x=>x.classList.toggle('active',x===b));$$('[data-command-panel]').forEach(x=>x.classList.toggle('active',x.dataset.commandPanel===tab));});
      $('#promotionStatusTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-promo-filter]');if(!b)return;promoFilter=b.dataset.promoFilter;$$('#promotionStatusTabs button').forEach(x=>x.classList.toggle('active',x===b));renderPromotions()});
      $('#promotionPageTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-promo-page-filter]');if(!b)return;promoPageFilter=b.dataset.promoPageFilter;promoPage=1;$$('#promotionPageTabs button').forEach(x=>x.classList.toggle('active',x===b));renderPromotions()});
      $('#promotionSearch')?.addEventListener('input',e=>{promoSearch=e.target.value.trim();promoPage=1;renderPromotions()});$('#promotionPrevPage')?.addEventListener('click',()=>{promoPage=Math.max(1,promoPage-1);renderPromotions()});$('#promotionNextPage')?.addEventListener('click',()=>{promoPage+=1;renderPromotions()});
      document.addEventListener('click',e=>{const t=e.target.closest('[data-mg-profile]');if(t)timeline(t.dataset.mgProfile);const p=e.target.closest('[data-promotion-user]');if(p)openPromotion(p.dataset.promotionUser);if(e.target.closest('[data-close-promotion],#closePromotionButton'))closePromotion();if(e.target.closest('#saveRpEvaluation'))saveEvaluation();if(e.target.closest('#addSanctionButton'))addSanction();const ss=e.target.closest('[data-sanction-status]');if(ss)sanctionStatus(ss.dataset.sanctionId,ss.dataset.sanctionStatus);const sd=e.target.closest('[data-sanction-delete]');if(sd)deleteSanctionAction(sd.dataset.sanctionDelete);const a=e.target.closest('[data-promo-action]');if(a&&!a.disabled)promotionAction(a.dataset.promoAction)});
      document.addEventListener('change',e=>{if(e.target.matches('[data-criterion-key]'))updateCriterion(e.target)});
      startManagementAutoRefresh();
    }catch{}
  }
  init();
})();
