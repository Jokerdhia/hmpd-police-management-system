(()=>{
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dur=s=>`${Math.floor(Number(s||0)/3600)}h ${String(Math.floor(Number(s||0)%3600/60)).padStart(2,'0')}m`;
  const dt=v=>v?new Date(v).toLocaleString('fr-FR'):'Jamais';
  let data=null,promotions=[],promoFilter='all',selectedPromotionUser=null;

  async function req(url,options={}){
    const init={cache:'no-store',...options};
    if(init.body&&typeof init.body!=='string'){
      init.headers={...(init.headers||{}),'Content-Type':'application/json','Idempotency-Key':`${Date.now()}-${Math.random()}`};
      init.body=JSON.stringify(init.body);
    }
    const r=await fetch(url,init),d=await r.json().catch(()=>null);
    if(!r.ok||!d?.success)throw new Error(d?.message||'Erreur');
    return d;
  }
  function notify(msg,ok=true){
    const n=$('#notification'); if(!n)return alert(msg);
    n.textContent=msg;n.className=`toast${ok?' success':''}`;setTimeout(()=>n.classList.add('hidden'),4500);
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
  function renderPromotions(){
    const box=$('#managementPromotions'); if(!box)return;
    const list=promotions.filter(p=>promoFilter==='all'||p.status===promoFilter);
    box.innerHTML=list.map(p=>`<button class="management-row promotion-row status-${esc(p.status)}" data-promotion-user="${p.user_id}">
      <img class="promo-avatar" src="${esc(p.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="">
      <div class="promo-main"><strong>${esc(p.display_name||p.user_id)}</strong><p>${esc(p.grade)} → ${esc(p.to_grade)} · ⭐ ${Number(p.points||0)} points d’activité${p.evaluation?` · RP ${p.evaluation.score}/100`:''}</p>${promotionProgress(p)}</div>
    </button>`).join('')||'<div class="empty">Aucun dossier dans ce statut.</div>';
    const eligible=promotions.filter(p=>p.status==='eligible').length;
    if($('#mgPromotions'))$('#mgPromotions').textContent=eligible;
  }
  function render(filter=''){
    if(!data)return;const q=filter.toLowerCase();
    $('#mgOnDuty').textContent=data.summary.onDuty;
    $('#mgAverageScore').textContent=data.summary.averageScore+'/100';
    $('#mgInactive').textContent=data.summary.inactive7;
    $('#managementAlerts').innerHTML=data.alerts.map(a=>{const o=data.officers.find(x=>x.user_id===a.user_id);return `<button class="management-row severity-${a.severity}" data-mg-profile="${a.user_id}"><span>${a.severity==='high'?'🔴':a.severity==='medium'?'🟠':'🔵'}</span><div><strong>${esc(o?.display_name||a.user_id)}</strong><p>${esc(a.message)}</p></div></button>`}).join('')||'<div class="empty">Aucune alerte.</div>';
    const cov=$('#coverageGrid');if(cov)cov.innerHTML=(data.coverage||[]).map(x=>`<div class="coverage-hour ${x.officers===0?'coverage-empty':x.officers<=2?'coverage-low':''}"><strong>${String(x.hour).padStart(2,'0')}h</strong><span>${x.officers}</span></div>`).join('');
    const list=data.officers.filter(o=>!q||String(o.display_name||'').toLowerCase().includes(q)||String(o.grade||'').toLowerCase().includes(q)||o.user_id.includes(q));
    $('#managementOfficerRows').innerHTML=list.map(o=>`<tr><td><strong>${esc(o.display_name||o.user_id)}</strong><small class="table-sub">${o.user_id}</small></td><td><span class="grade-pill">${esc(o.grade)}</span></td><td>${scoreBar(o)}</td><td>${dur(o.week_seconds)}</td><td>${o.active_sanctions?`⚠️ ${o.active_sanctions} sanction(s)`:'✅ RAS'}</td><td>${o.inactive_days===999?'Jamais':o.inactive_days+' j'}</td><td><button class="profile-button" data-promotion-user="${o.user_id}">Promotion</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="empty">Aucun résultat.</div></td></tr>';
  }
  function reportText(r){return [`RAPPORT HEBDOMADAIRE HMPD`,`Généré : ${new Date(r.generatedAt).toLocaleString('fr-FR')}`,``,`Effectif : ${r.summary.officers} | En service : ${r.summary.onDuty} | Score moyen : ${r.summary.averageScore}/100`,`Dossiers éligibles : ${promotions.filter(p=>p.status==='eligible').length} | Inactifs 7j+ : ${r.summary.inactive7}`,``,`TOP PRÉSENCE`,...r.topAttendance.map((o,i)=>`${i+1}. ${o.display_name||o.user_id} — ${dur(o.week_seconds)} — score ${o.score}/100`),``,`PROMOTIONS ÉLIGIBLES`,...(promotions.filter(p=>p.status==='eligible').length?promotions.filter(p=>p.status==='eligible').map(p=>`• ${p.display_name||p.user_id} → ${p.to_grade} (${p.progress.percent}%)`):['• Aucune']),``,`INACTIFS`,...(r.inactive.length?r.inactive.map(o=>`• ${o.display_name||o.user_id} — ${o.inactive_days} jours`):['• Aucun'])].join('\n')}

  async function load(){
    try{
      const [ov,audit,rep,pro]=await Promise.all([req('/api/management/overview'),req('/api/management/audit?limit=50'),req('/api/management/weekly-report'),req('/api/promotions')]);
      data=ov;promotions=pro.promotions||[];render($('#managementSearch')?.value||'');renderPromotions();
      $('#weeklyReport').textContent=reportText(rep.report);
      $('#managementAudit').innerHTML=audit.audit.map(x=>`<div class="management-row static"><span>🧾</span><div><strong>${esc(x.action)}</strong><p>${esc(x.actor_id)} → ${esc(x.target_id||'système')} · ${dt(x.created_at)}</p></div></div>`).join('')||'<div class="empty">Aucun audit.</div>';
    }catch(e){notify(e.message,false)}
  }

  async function timeline(id){
    try{const r=await req(`/api/management/officers/${id}/timeline?limit=80`);const o=data?.officers.find(x=>x.user_id===id);const html=`<div class="mg-profile"><h3>${esc(o?.display_name||id)}</h3>${o?scoreBar(o):''}<div class="timeline-list">${r.timeline.map(x=>`<div class="timeline-item"><time>${dt(x.created_at)}</time><div><strong>${esc(x.title)}</strong><p>${esc(x.detail||'')}</p></div></div>`).join('')||'<div class="empty">Aucun événement.</div>'}</div></div>`;const modal=$('#profileModal');$('#profileContent').innerHTML=html;modal?.classList.remove('hidden')}catch(e){notify(e.message,false)}
  }

  function stars(name,value=5){return `<label class="rp-rating"><span>${name}</span><select data-rp-rating="${name}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===value?'selected':''}>${n} / 5</option>`).join('')}</select></label>`}
  async function openPromotion(id){
    try{
      selectedPromotionUser=id;const r=await req(`/api/promotions/${id}`);const p=r.promotion;if(!p?.case){notify('Aucune promotion disponible pour ce grade.',false);return}
      const o=p.officer,m=statusMeta(p.case.status),progress=p.progress||{};
      $('#promotionModalTitle').textContent=`${o.display_name||id} — ${p.case.from_grade} → ${p.case.to_grade}`;
      $('#promotionModalSubtitle').textContent=p.requirement?.appointmentOnly?'Nomination High Command':'Dossier officiel de progression';
      const evalBlock=p.evaluation?`<div class="promo-eval-summary"><div><span>Dernière évaluation RP</span><strong>${p.evaluation.score}/100</strong></div><small>Évalué le ${dt(p.evaluation.created_at)} par ${esc(p.evaluation.evaluator_id)}</small></div>`:'<div class="promo-eval-summary"><div><span>Évaluation RP</span><strong>Non évalué</strong></div></div>';
      const general=p.requirement?.appointmentOnly?'':`<div class="promo-general-grid"><div class="promo-condition ${progress.daysOk?'done':'pending'}"><span>${progress.daysOk?'✅':'❌'}</span><div><strong>Ancienneté au grade</strong><p>${progress.daysInRank}/${progress.minDays} jours minimum</p></div></div><div class="promo-condition ${progress.disciplineOk?'done':'blocked'}"><span>${progress.disciplineOk?'✅':'🔒'}</span><div><strong>Discipline</strong><p>${progress.activeSanctions?`${progress.activeSanctions} sanction(s) active(s)`:'Aucune sanction active'}</p></div></div></div>`;
      const criteria=(progress.criteria||[]).map(c=>`<label class="promotion-criterion ${c.completed?'complete':''}"><input type="checkbox" data-criterion-key="${esc(c.key)}" ${c.completed?'checked':''}><span><strong>${esc(c.label)}</strong>${c.note?`<small>${esc(c.note)}</small>`:''}</span></label>`).join('');
      const reopen=['postponed','rejected'].includes(p.case.status)?'<button class="btn btn-secondary" data-promo-action="progress">↩️ Réouvrir le dossier</button>':'';
      const statusActions=`<div class="promo-actions">${reopen}<button class="btn btn-secondary" data-promo-action="evaluation" ${!progress.eligible?'disabled':''}>🔵 Mettre en évaluation</button><button class="btn btn-secondary" data-promo-action="postponed">⏳ Reporter</button><button class="btn btn-danger" data-promo-action="rejected">❌ Refuser</button><button class="btn btn-primary promo-approve" data-promo-action="approve" ${(progress.activeSanctions>0||(!progress.eligible&&!progress.appointmentOnly))?'disabled':''}>✅ Approuver la promotion</button></div>`;
      const sanctions=(p.sanctions||[]).map(x=>`<div class="sanction-row ${x.status==='active'?'active':''}"><div><strong>⚠️ ${esc(x.sanction_type)}</strong><p>${esc(x.reason)} · ${dt(x.created_at)}</p></div><div class="sanction-actions"><span>${esc(x.status)}</span>${x.status==='active'?`<button class="btn btn-secondary" data-sanction-status="expired" data-sanction-id="${x.id}">Clôturer</button>`:''}<button class="btn btn-danger" data-sanction-delete="${x.id}">Supprimer</button></div></div>`).join('')||'<div class="empty">Aucune sanction.</div>';
      $('#promotionModalContent').innerHTML=`<div class="promotion-header-card"><div class="promo-identity"><img src="${esc(o.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt=""><div><strong>${esc(o.display_name||id)}</strong><span>${esc(p.case.from_grade)} → ${esc(p.case.to_grade)}</span></div></div><div class="promo-status status-${esc(p.case.status)}">${m[0]} ${esc(m[1])}</div><div class="promo-percent"><strong>${progress.percent||0}%</strong><span>${progress.completed||0}/${progress.total||0} critères</span></div></div><div class="promo-track large"><i style="width:${progress.percent||0}%"></i></div>${general}<section class="promo-section"><div class="promo-section-head"><div><h3>متطلبات الترقية</h3><p>Cocher uniquement après vérification par un responsable.</p></div></div><div class="promotion-criteria">${criteria}</div></section><section class="promo-section"><div class="promo-section-head"><div><h3>RP Quality</h3><p>Évaluation sur 5 pour chaque critère.</p></div></div>${evalBlock}<div class="rp-grid">${stars('professionalism')}${stars('procedures')}${stars('radio')}${stars('teamwork')}${stars('reports')}${stars('responsiveness')}${stars('hierarchy')}</div><textarea id="rpEvaluationComment" placeholder="Commentaire de l’évaluateur..."></textarea><button class="btn btn-secondary" id="saveRpEvaluation">Enregistrer l’évaluation RP</button></section><section class="promo-section"><div class="promo-section-head"><div><h3>Discipline / Sanctions</h3><p>Une sanction active gèle automatiquement le dossier.</p></div></div><div class="sanction-create"><select id="sanctionType"><option>Avertissement oral</option><option>Avertissement écrit</option><option>Strike</option><option>Suspension</option><option>Rétrogradation</option><option>RP grave</option></select><input id="sanctionExpiry" type="datetime-local"><textarea id="sanctionReason" placeholder="Motif de la sanction..."></textarea><button class="btn btn-danger" id="addSanctionButton">Ajouter la sanction</button></div><div class="sanction-list">${sanctions}</div></section><section class="promo-section"><div class="promo-section-head"><div><h3>Décision High Command</h3><p>Les points seuls ne garantissent jamais une promotion.</p></div></div><textarea id="promotionDecisionReason" placeholder="Motif / commentaire de décision..."></textarea>${statusActions}</section>${p.history?.length?`<section class="promo-section"><h3>Historique des grades</h3><div class="timeline-list">${p.history.map(h=>`<div class="timeline-item"><time>${dt(h.created_at)}</time><div><strong>${esc(h.from_grade||'—')} → ${esc(h.to_grade)}</strong><p>${esc(h.reason||h.action||'')}</p></div></div>`).join('')}</div></section>`:''}`;
      $('#promotionModal').classList.remove('hidden');
    }catch(e){notify(e.message,false)}
  }
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
    const reason=$('#promotionDecisionReason')?.value||'';
    try{
      if(action==='approve') await req(`/api/promotions/${selectedPromotionUser}/approve`,{method:'POST',body:{reason}});
      else await req(`/api/promotions/${selectedPromotionUser}/status`,{method:'POST',body:{status:action,reason}});
      notify(action==='approve'?'Promotion approuvée et rôle Discord mis à jour.':'Dossier mis à jour.');
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
      const me=await req('/api/me');if(!me.permissions?.canManagePoints)return;
      const nav=$('#managementNav');nav?.classList.remove('hidden');nav?.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));nav.classList.add('active');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$('#managementPage')?.classList.add('active');$('#pageTitle').textContent='Centre de commandement';$('#pageSubtitle').textContent='Performance, promotions officielles et audit';load()});
      $('#managementRefresh')?.addEventListener('click',load);$('#managementSearch')?.addEventListener('input',e=>render(e.target.value));$('#copyWeeklyReport')?.addEventListener('click',()=>navigator.clipboard?.writeText($('#weeklyReport').textContent));
      $('#promotionStatusTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-promo-filter]');if(!b)return;promoFilter=b.dataset.promoFilter;$$('#promotionStatusTabs button').forEach(x=>x.classList.toggle('active',x===b));renderPromotions()});
      document.addEventListener('click',e=>{const t=e.target.closest('[data-mg-profile]');if(t)timeline(t.dataset.mgProfile);const p=e.target.closest('[data-promotion-user]');if(p)openPromotion(p.dataset.promotionUser);if(e.target.closest('[data-close-promotion],#closePromotionButton'))closePromotion();if(e.target.closest('#saveRpEvaluation'))saveEvaluation();if(e.target.closest('#addSanctionButton'))addSanction();const ss=e.target.closest('[data-sanction-status]');if(ss)sanctionStatus(ss.dataset.sanctionId,ss.dataset.sanctionStatus);const sd=e.target.closest('[data-sanction-delete]');if(sd)deleteSanctionAction(sd.dataset.sanctionDelete);const a=e.target.closest('[data-promo-action]');if(a&&!a.disabled)promotionAction(a.dataset.promoAction)});
      document.addEventListener('change',e=>{if(e.target.matches('[data-criterion-key]'))updateCriterion(e.target)});
    }catch{}
  }
  init();
})();
