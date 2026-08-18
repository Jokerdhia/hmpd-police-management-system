(()=>{
  const RETRY_STATUSES=new Set([429,502,503,504]);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const originalFetch=window.fetch.bind(window);
  let banner=null;

  function show(message,type="warning"){
    if(!banner){
      banner=document.createElement("div");
      banner.id="connectionBanner";
      banner.className="connection-banner hidden";
      banner.setAttribute("role","status");
      banner.setAttribute("aria-live","polite");
      document.body.appendChild(banner);
    }
    banner.textContent=message;
    banner.className=`connection-banner ${type}`;
  }

  function hide(){banner?.classList.add("hidden")}

  window.fetch=async(input,init={})=>{
    const method=String(init.method||"GET").toUpperCase();
    const safe=method==="GET"||method==="HEAD";
    const attempts=safe?3:1;
    let lastError;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await originalFetch(input,{...init,signal:init.signal||controller.signal});
        clearTimeout(timeout);
        if(safe&&RETRY_STATUSES.has(response.status)&&attempt<attempts-1){
          show("Serveur en reconnexion… nouvelle tentative automatique.");
          await sleep(900*(attempt+1));
          continue;
        }
        if(response.ok){hide();}
        else if(RETRY_STATUSES.has(response.status)){show("Serveur momentanément indisponible. Les données affichées sont conservées.","error")}
        return response;
      }catch(error){
        clearTimeout(timeout);lastError=error;
        if(!safe||attempt===attempts-1)break;
        show("Connexion interrompue… nouvelle tentative automatique.");
        await sleep(900*(attempt+1));
      }
    }
    show(navigator.onLine?"Serveur inaccessible. Les données affichées sont conservées.":"Connexion Internet perdue. En attente du réseau…","error");
    throw lastError||new Error("Serveur temporairement indisponible.");
  };

  window.addEventListener("offline",()=>show("Connexion Internet perdue. Les données affichées sont conservées.","error"));
  window.addEventListener("online",()=>{show("Connexion rétablie. Actualisation en cours…","success");setTimeout(()=>location.reload(),900)});

  document.addEventListener("submit",event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement)||form.dataset.submitLock==="1")return;
    form.dataset.submitLock="1";
    const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
    buttons.forEach(button=>button.disabled=true);
    setTimeout(()=>{delete form.dataset.submitLock;buttons.forEach(button=>button.disabled=false)},15000);
  },true);
})();
