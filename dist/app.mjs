import {STAGES,NICHES,fold,safeUrl,queryFor,normalizeElement,uniqueLeads,toCsv,validateBackup,digitalPresence,canProspect,mergePresenceLinks,sameBusiness,distanceKm,classifyWebsite} from './domain.mjs';
import {loadWorkspace,saveWorkspace,normalizeWorkspace} from './workspace.mjs';
import {createLeadStore} from './lead-store.mjs';
import {GOOGLE_HISTORY_KEY,loadGoogleHistory,getGoogleCheck,googleMapsUrl} from './google-history.mjs';
import {createGoogleResultSession} from './google-results.mjs';
import {needsGoogleCheck} from './google-queue.mjs';
import {DEFAULT_SEARCH_CENTER,normalizeSearchCenter,normalizeSearchArea,searchAreaKey,sameSearchArea,nearestCity,searchContext} from './search-area.mjs';
window.prospectaGoogleSession=createGoogleResultSession();
const $=id=>document.getElementById(id),STORAGE='orion-prospecta-v1',CACHE='orion-prospecta-cache-v1';
let cities=[],results=[],saved=[],visible=[],view='discover',busy=false,searched=false,lastSearch=0,selectedId='',editingLead=null,editingForm=null,rechecking=false,googleReady=false,map,markers,areaCircle,currentCity,noticeTimer,storageAvailable=true,leadStore,crmDirty=false;
const initialWorkspace=loadWorkspace();
let searchCenter=initialWorkspace.workspace?.searchCenter||{...DEFAULT_SEARCH_CENTER},searchedArea=initialWorkspace.workspace?.searchedArea||null,centerMarker;
let restoredWorkspace=initialWorkspace.workspace,workspaceReady=false,workspaceTimer,restoringWorkspace=false,searchedAt='',pendingListScroll=null,workspaceWarning='';
let googleHistory=loadGoogleHistory().entries,googleFrame=null,pendingGoogleEntry=null,googleViewShown=false,localScrollTop=0,localListScrollTop=0,suspendedDialog=null,pendingReviewId='';
const localTitle=document.title;
const categories={hairdresser:'Salão / barbearia',beauty:'Beleza',car_repair:'Oficina mecânica',car_parts:'Autopeças',tyres:'Pneus',restaurant:'Restaurante',cafe:'Café',fast_food:'Lanchonete',dentist:'Odontologia',doctors:'Consultório',clinic:'Clínica',pharmacy:'Farmácia',pet:'Pet shop',pet_grooming:'Banho e tosa',veterinary:'Veterinário',bakery:'Padaria',supermarket:'Supermercado',convenience:'Mercado',clothes:'Vestuário',accountant:'Contabilidade',lawyer:'Advocacia',hotel:'Hotel',guest_house:'Pousada',car_wash:'Lavação',fuel:'Posto de combustível'};
try{leadStore=createLeadStore({storage:localStorage,key:STORAGE});const initial=leadStore.load();saved=initial.leads;storageAvailable=initial.ok;}catch{storageAvailable=false;}
function toast(message){clearTimeout(noticeTimer);$('status-message').textContent=message;$('status-message').classList.add('visible');noticeTimer=setTimeout(()=>$('status-message').classList.remove('visible'),6500);}
function persist(){const result=leadStore?.save(saved);if(result?.ok){saved=result.leads;crmDirty=false;storageAvailable=true;updateLocalState();return true;}crmDirty=true;storageAvailable=false;$('local-state').textContent='Alterações ainda não salvas. Os dados anteriores foram preservados.';toast(result?.error||'Não foi possível salvar a lista. Mantenha esta página aberta para preservar as alterações.');return false;}
function countLabel(count,singular,plural){return count+' '+(count===1?singular:plural);}
function updateLocalState(){if(storageAvailable)$('local-state').textContent=countLabel(saved.filter(canProspect).length,'oportunidade','oportunidades')+' · '+countLabel(saved.length,'revisão','revisões')+' neste navegador';}
function captureWorkspace(){const center=map?.getCenter();return {version:1,results,city:currentCity||null,searchCenter,searchedArea,search:{cityInput:$('city').value,niche:$('niche').value,radius:Number($('radius').value)},view,filters:{name:$('name-filter').value,contactOnly:$('contact-only').checked,stage:$('stage-filter').value,sort:$('sort').value,presence:$('presence-filter').value},selectedId,listScrollTop:googleViewShown?localListScrollTop:$('results').scrollTop,mapView:center?{lat:center.lat,lon:center.lng,zoom:map.getZoom()}:restoredWorkspace?.mapView||null,searched,searchedAt};}
function flushWorkspace({notify=false}={}){
 clearTimeout(workspaceTimer);if(!workspaceReady||restoringWorkspace||busy)return {ok:true};
 const result=saveWorkspace(captureWorkspace());
 $('workspace-state').textContent=result.persistent?'Busca e posição salvas automaticamente neste navegador.':result.session?'Busca preservada apenas nesta aba. O armazenamento permanente está indisponível.':'Não foi possível salvar a busca. Mantenha esta página aberta.';
 $('workspace-state').classList.toggle('save-warning',!result.persistent);
 if(notify&&!result.ok)toast('Não foi possível preservar a busca. A navegação foi interrompida para não perder sua lista.');
 workspaceWarning=result.ok?'':$('workspace-state').textContent;return result;
}
function scheduleWorkspaceSave(){if(workspaceReady&&!restoringWorkspace&&!busy){clearTimeout(workspaceTimer);workspaceTimer=setTimeout(flushWorkspace,180);}}
function restoreWorkspace(snapshot){
 const state=normalizeWorkspace(snapshot);if(!state)return false;restoringWorkspace=true;restoredWorkspace=state;
 results=state.results;searched=state.searched;searchedAt=state.searchedAt;currentCity=state.city||currentCity;searchCenter=state.searchCenter||{...DEFAULT_SEARCH_CENTER};searchedArea=state.searchedArea;view=state.view;selectedId=state.selectedId;pendingListScroll=state.listScrollTop;
 $('city').value=state.search.cityInput;$('niche').value=state.search.niche;$('radius').value=String(state.search.radius);$('name-filter').value=state.filters.name;$('contact-only').checked=state.filters.contactOnly;$('stage-filter').value=state.filters.stage;$('sort').value=state.filters.sort;$('presence-filter').value=state.filters.presence;
 if(map){if(state.mapView)map.setView([state.mapView.lat,state.mapView.lon],state.mapView.zoom);else map.setView([searchCenter.lat,searchCenter.lon],12);}
 updateSearchArea();
 render();restoringWorkspace=false;return true;
}
function recoverPreviousSearch(){
 let entries=[];try{const raw=JSON.parse(localStorage.getItem(CACHE)||'[]');if(Array.isArray(raw))entries=raw.filter(e=>e&&typeof e.key==='string'&&Number.isFinite(e.time)&&Array.isArray(e.elements)).sort((a,b)=>b.time-a.time);}catch{}
 for(const entry of entries){const parts=entry.key.split(':'),city=parts[0]==='point'?null:cities.find(c=>String(c.id)===parts[0]),niche=parts[0]==='point'?parts[3]:parts[1],radius=Number(parts[0]==='point'?parts[4]:parts[2]),center=parts[0]==='point'?normalizeSearchCenter({lat:Number(parts[1]),lon:Number(parts[2]),label:'Ponto no mapa'}):city?{lat:city.lat,lon:city.lon,label:city.name+' · '+city.uf,mode:'city'}:null,area=normalizeSearchArea({...center,niche,radius});if(!area)continue;
  const instant=new Date(entry.time);if(!Number.isFinite(instant.getTime()))continue;const stamp=instant.toISOString(),context=searchContext(area,cities),recovered=uniqueLeads(entry.elements.slice(0,600).map(e=>{try{const lead=normalizeElement(e,context);return lead?{...lead,fetchedAt:stamp}:null;}catch{return null;}}).filter(Boolean));
  if(recovered.length)return restoreWorkspace({version:1,results:recovered,city,searchCenter:center,searchedArea:area,search:{cityInput:city?city.name+' · '+city.uf:'',niche,radius},view:'review',searched:true,searchedAt:stamp});
 }
 try{const raw=JSON.parse(sessionStorage.getItem('prospecta-google-candidates-v1')||'[]'),list=Array.isArray(raw)?raw:raw?.candidates;if(Array.isArray(list)&&list.length){const city=cities.find(c=>list[0]?.city===c.name+' · '+c.uf);const recovered=list.filter(l=>l&&typeof l==='object').map(l=>({...l,category:'Negócio local',distance:city?distanceKm(city.lat,city.lon,l.lat,l.lon):0}));const state=normalizeWorkspace({version:1,results:recovered,city,search:{cityInput:city?city.name+' · '+city.uf:list[0]?.city,niche:'all',radius:5},view:'review',searched:true});if(state?.results.length)return restoreWorkspace(state);}}catch{}
 return false;
}
function selectedArea(){return normalizeSearchArea({...searchCenter,niche:$('niche').value,radius:Number($('radius').value)});}
function updateSearchArea(){
 const area=selectedArea();if(!area)return;
 const pending=searched&&!sameSearchArea(area,searchedArea);
 $('search-center-label').textContent=searchCenter.mode==='city'?searchCenter.label:'Ponto escolhido no mapa';$('search-center-coordinates').textContent=searchCenter.lat.toFixed(5)+', '+searchCenter.lon.toFixed(5);
 $('map-caption').textContent=(searchCenter.mode==='city'?searchCenter.label:'Centro escolhido')+' · raio '+area.radius+' km';$('area-pending').hidden=!pending;
 $('use-map-center').disabled=busy||!map;$('go-city').disabled=busy||!cities.length;
 if(!map)return;
 if(areaCircle)areaCircle.setLatLng([area.lat,area.lon]).setRadius(area.radius*1000);else areaCircle=L.circle([area.lat,area.lon],{radius:area.radius*1000,color:'#1d614f',weight:1.5,dashArray:'6 6',fillOpacity:.055,interactive:false}).addTo(map);
 if(centerMarker){centerMarker.setLatLng([area.lat,area.lon]);if(busy)centerMarker.dragging.disable();else centerMarker.dragging.enable();}
 else{centerMarker=L.marker([area.lat,area.lon],{draggable:true,title:'Centro da busca: arraste para mover',alt:'Centro da busca',icon:L.divIcon({className:'search-center-pin',html:'<span aria-hidden="true">＋</span>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map);centerMarker.bindTooltip('Centro da busca · arraste para mover',{direction:'top',offset:[0,-14]});centerMarker.on('drag',()=>areaCircle.setLatLng(centerMarker.getLatLng()));centerMarker.on('dragend',()=>{const point=centerMarker.getLatLng().wrap();setSearchCenter({lat:point.lat,lon:point.lng,mode:'map',label:'Ponto no mapa'});});}
}
function setSearchCenter(value,{moveMap=false}={}){
 if(busy)return;const center=normalizeSearchCenter(value);if(!center)return;searchCenter=center;updateSearchArea();if(map&&moveMap)map.setView([center.lat,center.lon],13);scheduleWorkspaceSave();
}
function goToCity(){
 if(busy)return;const typed=fold($('city').value),city=cities.find(c=>fold(c.name+' · '+c.uf)===typed);if(!city){toast('Escolha uma cidade sugerida para navegar. Você também pode escolher o centro diretamente no mapa.');$('city').focus();return;}
 currentCity=city;setSearchCenter({lat:city.lat,lon:city.lon,label:city.name+' · '+city.uf,mode:'city'},{moveMap:true});
}
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function anchor(label,url,title){const a=node('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';if(title)a.title=title;return a;}
function hasContact(l){return !!(l.phoneNumber||l.instagram||l.whatsapp);}
function combineEvidence(base,fresh){return {...base,...fresh,website:fresh.website||base.website||'',instagram:fresh.instagram||base.instagram||'',presenceLinks:mergePresenceLinks(base.presenceLinks,fresh.presenceLinks)};}
function merged(l){const matches=saved.filter(s=>sameBusiness(s,l)),own=matches.find(s=>s.id===l.id)||matches[0],existingPresence=matches.some(s=>digitalPresence(s).status==='exists'),ignored=matches.some(s=>s.ignored===true)||l.ignored===true,combined=matches.reduce((data,entry)=>combineEvidence(entry,data),l);return {...combined,presenceLinks:mergePresenceLinks(combined.presenceLinks,...matches.map(s=>digitalPresence(s).urls)),id:own?.id||l.id,sourceUrl:own?.sourceUrl||l.sourceUrl,stage:own?.stage||l.stage||'Revisar',verified:existingPresence?'exists':own?.verified||l.verified||'unknown',reviewScope:existingPresence?matches.find(s=>digitalPresence(s).status==='exists')?.reviewScope:own?.reviewScope||l.reviewScope||'',reviewedAt:own?.reviewedAt||l.reviewedAt||'',reviewUrl:own?.reviewUrl||l.reviewUrl||'',ignored,ignoredAt:matches.find(s=>s.ignored===true)?.ignoredAt||l.ignoredAt||'',followup:own?.followup||l.followup||'',notes:own?.notes||l.notes||''};}
function isSaved(id){return saved.some(l=>l.id===id);}
function linksFor(l){const wrap=node('div','contact-links');if(l.phoneNumber)wrap.append(anchor('☎ Telefone','tel:+'+l.phoneNumber,l.phone));if(l.whatsapp)wrap.append(anchor(l.whatsappConfirmed?'WhatsApp':'Testar WhatsApp',l.whatsapp,l.whatsappConfirmed?'WhatsApp informado na fonte':'Número de telefone; pode não ter WhatsApp'));if(l.instagram)wrap.append(anchor('Instagram',l.instagram));if(!hasContact(l))wrap.append(node('span','no-contact','Sem contato na fonte'));return wrap;}
function empty(title,body,loading=false){$('results').replaceChildren();const wrap=node('div','empty');wrap.append(node('div',loading?'loader':'empty-mark',loading?'':'⌖'),node('h2','',title),node('p','',body));$('results').append(wrap);}
function reviewButton(){const button=node('button','primary','Ver candidatos para conferir');button.type='button';button.addEventListener('click',()=>setView('review'));$('results').querySelector('.empty').append(button);}
function reviewDate(l){return l.reviewedAt?new Date(l.reviewedAt).toLocaleDateString('pt-BR'):'';}
function actionLabel(l){return canProspect(l)?'Editar oportunidade ↗':l.ignored||digitalPresence(l).status==='exists'?'Ver revisão ↗':'Verificar presença ↗';}
function googleCandidates(){if(!storageAvailable)return [];const text=fold($('name-filter').value),stage=$('stage-filter').value;return (view==='saved'?saved:searched?results:saved).map(merged).filter(l=>needsGoogleCheck(l,saved)&&(!text||fold(l.name).includes(text))&&(!$('contact-only').checked||hasContact(l))&&(view!=='saved'||!stage||l.stage===stage));}
function googleSourceCandidates(leads){return leads.slice(0,600).map(l=>({id:l.id,name:l.name,city:l.city,address:l.address,lat:l.lat,lon:l.lon,phoneNumber:l.phoneNumber,category:l.category,distance:l.distance,fetchedAt:l.fetchedAt}));}
function deliverGoogleEntry(){
 if(!googleViewShown||!pendingGoogleEntry||typeof googleFrame?.contentWindow?.prospectaGoogleReceive!=='function')return;
 const payload=pendingGoogleEntry;pendingGoogleEntry=null;googleFrame.contentWindow.prospectaGoogleReceive(payload);
}
window.prospectaGoogleViewReady=deliverGoogleEntry;
function hasReviewDraft(){const fields={verified:'lead-verified',reviewUrl:'lead-review-url',stage:'lead-stage',followup:'lead-followup',notes:'lead-notes'};return !!editingForm&&(rechecking||Object.entries(fields).some(([field,id])=>$(id).value!==editingForm[field]));}
function updateGoogleView(){
 const show=location.hash==='#google';
 if(show&&!googleViewShown){localScrollTop=window.scrollY;localListScrollTop=$('results').scrollTop;suspendedDialog=document.querySelector('dialog[open]');suspendedDialog?.close();}
 const wasGoogle=googleViewShown;googleViewShown=show;$('local-screen').hidden=show;$('local-screen').inert=show;$('google-screen').hidden=!show;document.body.classList.toggle('google-view',show);document.title=show?'Conferir no Google · Prospecta':localTitle;
 if(show){
  if(!googleFrame){
   try{if(!sessionStorage.getItem('prospecta-google-candidates-v1'))sessionStorage.setItem('prospecta-google-candidates-v1',JSON.stringify(googleSourceCandidates(googleCandidates())));}catch{}
   googleFrame=document.createElement('iframe');googleFrame.id='google-frame';googleFrame.title='Conferência Google de estabelecimentos';googleFrame.src=new URL('./google.html',import.meta.url).href;googleFrame.addEventListener('load',deliverGoogleEntry);$('google-screen').append(googleFrame);
  }
  deliverGoogleEntry();if(!wasGoogle)googleFrame.focus();
 }else if(wasGoogle){
  pendingGoogleEntry=null;pendingListScroll=localListScrollTop;reloadSaved();window.scrollTo({top:localScrollTop,behavior:'instant'});requestAnimationFrame(()=>map?.invalidateSize({pan:false}));
  const dialog=suspendedDialog;suspendedDialog=null;
  if(pendingReviewId){
   const id=pendingReviewId;pendingReviewId='';const lead=[...results,...saved].map(merged).find(item=>item.id===id);
   if(dialog?.id==='lead-dialog'&&(editingLead?.id===id||hasReviewDraft())){dialog.showModal();if(editingLead?.id!==id){pendingReviewId=id;$('lead-review-note').textContent='Sua revisão em andamento foi preservada. Salve ou feche esta revisão para abrir o outro candidato.';}}else if(lead)openLead(lead);else dialog?.showModal();
  }else dialog?.showModal();
 }
}
window.prospectaReturnToList=()=>{
 pendingGoogleEntry=null;
 if(location.hash==='#google'&&history.state?.prospectaGoogle===true)history.back();
 else{const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);updateGoogleView();}
};
function openGoogle(candidates,{runSingle=false}={}){
 if(crmDirty&&!persist())return;
 const latest=leadStore?.load();if(!latest?.ok){toast('Não foi possível conferir Minha lista. A consulta foi bloqueada para evitar repetir negócios já salvos.');return;}saved=latest.leads;storageAvailable=true;
 googleHistory=loadGoogleHistory().entries;
 const eligible=candidates.map(merged).filter(l=>needsGoogleCheck(l,saved));
 if(!eligible.length){toast('Não há candidatos novos para consultar. Negócios da Minha lista ficam fora da consulta Google.');render();return;}
 if(!visible.length){if(view==='discover')view='review';else if(view==='saved'&&$('presence-filter').value==='qualified')$('presence-filter').value='all';render();}
 if(!flushWorkspace({notify:true}).ok)return;
 try{
  googleHistory=loadGoogleHistory().entries;
  const list=googleSourceCandidates(eligible);
  const payload={candidates:list,selectedIds:runSingle?[list[0].id]:[],runSingle:runSingle&&!getGoogleCheck(list[0],googleHistory)};
  // Persist only the source candidates. An explicit API request is delivered once
  // in memory, so reload or browser Forward never repeats it.
  sessionStorage.setItem('prospecta-google-candidates-v1',JSON.stringify({...payload,runSingle:false}));
  pendingGoogleEntry=payload;
  if(location.hash!=='#google')history.pushState({prospectaGoogle:true},'','#google');
  updateGoogleView();
 }
 catch{toast('Não foi possível preparar a conferência. Confira se o armazenamento da sessão está disponível.');}
}
function setIgnored(l,ignored){
 const lead=merged(l),ignoredAt=ignored?new Date().toISOString():'';let found=false;
 saved=saved.map(own=>{if(!sameBusiness(own,lead))return own;found=true;return {...own,ignored,ignoredAt};});if(!found)saved.push({...lead,ignored,ignoredAt});
 const ok=persist();render();if(ok)toast(ignored?'Estabelecimento ignorado. Você pode desfazer em “Ignorados”.':'Estabelecimento disponível novamente para verificar.');
}
async function googleStatus(){
 try{const response=await fetch(new URL('./api/places/status',import.meta.url),{cache:'no-store'});if(!response.ok)throw new Error();const status=await response.json();googleReady=status.enabled===true;$('google-state').textContent=googleReady?'Disponível com limite local de consultas.':'Configure PLACESAPI no .env e reinicie npm start.';}
 catch{$('google-state').textContent='Use npm start com PLACESAPI no .env para habilitar.';}
 finally{render();}
}
function render(){
 if(googleViewShown)return;
 const listScroll=pendingListScroll??$('results').scrollTop;
 const pool=(searched?results:saved).map(merged),pending=pool.filter(l=>!l.ignored&&digitalPresence(l).status==='unknown'),excluded=pool.filter(l=>!l.ignored&&digitalPresence(l).status==='exists'),ignoredCount=saved.filter(l=>l.ignored).length;
 $('found-count').textContent=pool.filter(canProspect).length;$('review-count').textContent=pending.length;$('saved-count').textContent=saved.filter(canProspect).length;
 for(const [id,key] of [['discover-tab','discover'],['review-tab','review'],['saved-tab','saved']])$(id).setAttribute('aria-pressed',view===key);
 $('stage-filter').hidden=view!=='saved';$('presence-filter-label').hidden=view!=='saved';
 $('show-ignored').hidden=view!=='review'||!ignoredCount;$('show-ignored').textContent='Ignorados ('+ignoredCount+')';
 $('google-review').disabled=busy||!googleCandidates().length;
 $('verification-summary').textContent=(searched||saved.length)?pending.length+' para verificar · '+excluded.length+' com site ou solução online.':'Redes sociais não eliminam candidatos. Confira site, cardápio e pedidos.';
 updateLocalState();
 if(busy){visible=[];renderMarkers();empty('Consultando o mapa…','Buscando registros reais. Pode levar até 35 segundos.',true);$('result-caption').textContent='Busca em andamento';$('export-csv').disabled=true;return;}
 const text=fold($('name-filter').value),stage=$('stage-filter').value;
 visible=(view==='saved'?saved.map(merged):pool).filter(l=>(view==='review'?!l.ignored&&digitalPresence(l).status==='unknown':view==='saved'&&$('presence-filter').value==='all'?true:view==='saved'&&$('presence-filter').value==='ignored'?l.ignored===true:canProspect(l))&&(!$('contact-only').checked||hasContact(l))&&(!text||fold(l.name).includes(text))&&(view!=='saved'||!stage||l.stage===stage));
 const sort=$('sort').value;visible.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'pt-BR'):sort==='contact'?(Number(hasContact(b))-Number(hasContact(a))||a.distance-b.distance):a.distance-b.distance);
 $('result-caption').textContent=view==='review'?countLabel(visible.length,'candidato não qualificado','candidatos não qualificados'):view==='saved'&&$('presence-filter').value==='ignored'?countLabel(visible.length,'estabelecimento ignorado','estabelecimentos ignorados'):view==='saved'&&$('presence-filter').value==='all'?countLabel(visible.length,'revisão salva','revisões salvas'):countLabel(visible.length,'oportunidade verificada','oportunidades verificadas');$('export-csv').disabled=!visible.length;$('export-csv').title=view==='review'?'Exportar candidatos não qualificados':view==='saved'&&$('presence-filter').value!=='qualified'?'Exportar revisões sem tratá-las como oportunidades':'Exportar oportunidades verificadas';
 $('results').replaceChildren();if(!visible.length){
  if(view==='review')empty(pending.length?'Nenhum candidato nesses filtros':'Nenhum candidato pendente',pending.length?'Ajuste o nome ou o filtro de contato.':searched?'Os negócios ignorados ou com site ou solução online ficaram fora desta fila. Tente outro nicho ou consulte “Ignorados”.':'Faça uma busca para encontrar candidatos que ainda precisam de conferência.');
  else if(view==='saved')empty($('presence-filter').value==='ignored'?'Nenhum estabelecimento ignorado nesses filtros':'Nenhuma oportunidade nesses filtros',saved.length?'Ajuste os filtros ou selecione “Todas as revisões” para consultar os registros salvos.':'Confira os candidatos em “Verificar” e salve a revisão antes de abordar.');
  else if(!searched&&!saved.length)empty('Sua lista começa com uma conferência','Escolha o centro no mapa, o nicho e o raio. Registros sem solução identificada vão para “Verificar”; só sua revisão libera oportunidades.');
  else{empty('Nenhuma oportunidade verificada',pending.length?pending.length+' candidatos ainda precisam de conferência. A falta de site na fonte não basta para indicar contato.':excluded.length?'Os negócios com site ou solução online foram excluídos. Tente outro nicho ou aumente o raio.':'Não há oportunidades nesses filtros. Ajuste os filtros ou faça outra busca.');if(pending.length)reviewButton();}
 }
 for(const l of visible){
  const presence=digitalPresence(l),qualified=canProspect(l),card=node('article','lead-card'+(l.id===selectedId?' is-selected':''));card.dataset.id=l.id;
  const top=node('div','card-top'),name=node('button','card-name',l.name);name.type='button';name.addEventListener('click',()=>focusLead(l));top.append(name,node('span','distance',l.distance.toLocaleString('pt-BR',{maximumFractionDigits:1})+' km'));
  card.append(top,node('div','card-category',categories[l.category]||l.category.replaceAll('_',' ')),node('p','card-address',l.address));
  const badges=node('div','badges');badges.append(node('span','badge '+(qualified?'badge-site':'badge-missing'),l.ignored?'Ignorado por você':presence.label));
  if(qualified)badges.append(node('span','badge badge-stage',l.stage));if(l.reviewedAt)badges.append(node('span','badge badge-date','Conferido: '+reviewDate(l)));if(qualified&&l.followup)badges.append(node('span','badge badge-date','Retorno: '+l.followup.split('-').reverse().join('/')));
  const googleCheck=getGoogleCheck(l,googleHistory);if(googleCheck){const badge=node('span','badge badge-google','Google consultado: '+new Date(googleCheck.checkedAt).toLocaleDateString('pt-BR'));badge.title='Consulta realizada em '+new Date(googleCheck.checkedAt).toLocaleString('pt-BR');badges.append(badge);}card.append(badges);
  if(googleCheck){const link=anchor(googleCheck.placeId?'Abrir ficha no Maps ↗':'Buscar no Maps ↗',googleMapsUrl(l,googleCheck),'Abre o Google Maps sem consumir uma consulta da API');link.className='google-profile-link';card.append(link);}
  const bottom=node('div','card-bottom'),save=node('button','save-button'+(isSaved(l.id)?' saved':''),actionLabel(l));save.type='button';save.addEventListener('click',()=>openLead(l));bottom.append(qualified?linksFor(l):node('span','no-contact',l.ignored||presence.status==='exists'?'Fora da prospecção':'Confira antes de abordar'),save);card.append(bottom);$('results').append(card);
  if(l.ignored){const actions=node('div','review-card-actions'),restore=node('button','restore-ignored-button','Voltar a verificar');restore.type='button';restore.addEventListener('click',()=>setIgnored(l,false));actions.append(restore);card.append(actions);}
  else if(view==='review'){const actions=node('div','review-card-actions'),ignore=node('button','ignore-button','Ignorar');ignore.type='button';ignore.setAttribute('aria-label','Ignorar '+l.name);ignore.addEventListener('click',()=>setIgnored(l,true));actions.append(ignore);if(needsGoogleCheck(l,saved)){const google=node('button','google-button',googleCheck?'Rever consulta':'Consultar Google');google.type='button';google.setAttribute('aria-label',(googleCheck?'Rever consulta de ':'Consultar ')+l.name+' no Google');google.disabled=!googleReady&&!googleCheck;google.title=googleCheck?'Volta à conferência nesta aba, sem repetir a consulta automaticamente':'Consulta individual; usa uma tentativa do limite Google';google.addEventListener('click',()=>openGoogle([l],{runSingle:true}));actions.append(google);}card.append(actions);}
 }
 renderMarkers();$('results').scrollTop=listScroll;pendingListScroll=null;scheduleWorkspaceSave();
}
function setupMap(){if(!window.L){$('map-warning').hidden=false;return;}map=L.map('map',{zoomControl:false}).setView([searchCenter.lat,searchCenter.lon],12);L.control.zoom({position:'topright'}).addTo(map);markers=L.layerGroup().addTo(map);map.on('click',event=>{const point=event.latlng.wrap();setSearchCenter({lat:point.lat,lon:point.lng,mode:'map',label:'Ponto no mapa'});});updateSearchArea();let supportsGL=false;try{const canvas=document.createElement('canvas');supportsGL=!!canvas.getContext('webgl2')||!!canvas.getContext('webgl');}catch{}if(supportsGL&&L.maplibreGL&&window.maplibregl){try{const layer=L.maplibreGL({style:'https://tiles.openfreemap.org/styles/positron',maxZoom:19}).addTo(map);const gl=layer.getMaplibreMap();let errors=0;gl.on('error',()=>{if(++errors>=4)$('map-warning').hidden=false;});gl.on('load',()=>{$('map-warning').hidden=true;});}catch{fallbackMap();}}else fallbackMap();}
async function fallbackMap(){try{const style=await fetch('https://tiles.openfreemap.org/styles/positron').then(r=>{if(!r.ok)throw new Error('Style unavailable');return r.json();});const source=Object.values(style.sources).find(s=>s.type==='vector'&&s.url);if(!source||new URL(source.url).hostname!=='tiles.openfreemap.org')throw new Error('Map source unavailable');const tilejson=await fetch(source.url).then(r=>{if(!r.ok)throw new Error('Tiles unavailable');return r.json();});const tile=tilejson.tiles?.[0];if(!tile||new URL(tile).hostname!=='tiles.openfreemap.org')throw new Error('Map tiles unavailable');const quiet={weight:0,opacity:0,fillOpacity:0,radius:0},area=(color,opacity=1)=>({fill:true,fillColor:color,fillOpacity:opacity,stroke:false,weight:0});const road=(p,z)=>({color:['motorway','trunk','primary'].includes(p.class)?'#d9cbb4':'#fff',weight:Math.max(1,(z-10)/2)+(['motorway','trunk','primary'].includes(p.class)?1:0),opacity:1});const styles={};for(const item of tilejson.vector_layers||[])styles[item.id]=quiet;Object.assign(styles,{water:area('#c8dfe0'),waterway:{color:'#c8dfe0',weight:2},landcover:area('#d7e4cd',.6),landuse:area('#e6e9dc',.6),park:area('#d5e5cb',.8),building:{...area('#d7dcd3'),stroke:true,color:'#c5cec2',weight:.4},transportation:road,boundary:{color:'#aebca6',weight:1,dashArray:'4 4',fill:false}});const layer=L.vectorGrid.protobuf(tile,{rendererFactory:L.canvas.tile,vectorTileLayerStyles:styles,interactive:false,maxNativeZoom:tilejson.maxzoom||14,maxZoom:19,attribution:'<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);layer.on('load',()=>{$('map-warning').hidden=true;});layer.on('tileerror',()=>{$('map-warning').hidden=false;});$('map').dataset.mode='simplified';}catch(error){console.warn('Map fallback:',error.message);$('map-warning').hidden=false;}}
function renderMarkers(){if(!map)return;markers.clearLayers();for(const l of visible){const presence=digitalPresence(l),marker=L.circleMarker([l.lat,l.lon],{bubblingMouseEvents:false,radius:l.id===selectedId?9:6,color:'#fff',weight:2,fillColor:canProspect(l)?'#34765f':presence.status==='exists'?'#82918b':'#d08b3e',fillOpacity:.96}).addTo(markers);const content=node('div'),title=node('strong','',l.name),info=node('div','',presence.status==='exists'?'Site ou solução online · excluído':canProspect(l)?'Sem site após revisão':'Ainda não qualificado'),btn=node('button','map-popup-button',actionLabel(l));btn.addEventListener('click',()=>openLead(l));content.append(title,info,btn);marker.bindPopup(content);marker.on('click',()=>{selectedId=l.id;const cards=$('results').querySelectorAll('.lead-card');for(const card of cards){card.classList.toggle('is-selected',card.dataset.id===l.id);if(card.dataset.id===l.id)card.scrollIntoView({block:'nearest',behavior:'smooth'});}});}}
function fitMap(){if(!map)return;const points=visible.map(l=>[l.lat,l.lon]);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[55,55],maxZoom:15});else if(areaCircle)map.fitBounds(areaCircle.getBounds(),{padding:[35,35],maxZoom:15});else map.setView([searchCenter.lat,searchCenter.lon],12);}
function focusLead(l){selectedId=l.id;render();if(map){map.setView([l.lat,l.lon],16);for(const marker of markers.getLayers()){const p=marker.getLatLng();if(p.lat===l.lat&&p.lng===l.lon){marker.openPopup();break;}}}}
function openLead(l){
 selectedId=l.id;editingLead=merged(l);rechecking=false;$('lead-recheck').hidden=!canProspect(editingLead);const googleCheck=getGoogleCheck(editingLead,googleHistory);$('lead-google').hidden=(!googleReady&&!googleCheck)||!needsGoogleCheck(editingLead,saved);$('lead-google').textContent=googleCheck?'Rever consulta Google':'Consultar site e funcionamento no Google';const presence=digitalPresence(editingLead),known=digitalPresence({...editingLead,verified:'unknown',reviewUrl:''}).solutions.length>0;
 $('lead-title').textContent=l.name;$('lead-address').textContent=l.address+' · '+l.city;$('lead-stage').value=editingLead.stage;$('lead-verified').value=presence.status==='exists'?'exists':presence.status==='missing'?'missing':'unknown';$('lead-verified').querySelector('[value="missing"]').disabled=known||editingLead.ignored;
 $('lead-followup').value=editingLead.followup;$('lead-notes').value=editingLead.notes;$('lead-review-url').value=editingLead.reviewUrl||'';$('lead-review-url').setCustomValidity('');$('lead-remove').hidden=!isSaved(l.id);
 editingForm={verified:$('lead-verified').value,reviewUrl:$('lead-review-url').value,stage:$('lead-stage').value,followup:$('lead-followup').value,notes:$('lead-notes').value};
 for(const id of ['review-maps','review-web','review-confirm'])$(id).checked=canProspect(editingLead);
 const summary=node('p','muted',presence.status==='exists'?'Site ou solução online identificada. Este negócio fica fora das oportunidades.':canProspect(editingLead)?'Conferido por você em '+reviewDate(editingLead)+'. Sem site ou solução online nessa revisão.':presence.socialOnly?'Só redes sociais identificadas. Pode ser uma oportunidade para site, cardápio ou pedidos; confirme a revisão abaixo.':'Confira se já existe site, cardápio, pedidos ou reservas. Facebook e Instagram não eliminam o candidato.');
 const evidence=node('div','contact-links'),kinds={website:'Site',menu:'Cardápio',ordering:'Pedidos / loja',booking:'Reservas',social:'Rede social',links:'Links'};for(const item of presence.urls)evidence.append(anchor((kinds[item.kind]||'Presença digital')+' ↗',item.url));$('presence-summary').replaceChildren(summary,evidence);
 const query=l.name+' '+l.city,links=node('div','contact-links');links.append(anchor(googleCheck?.placeId?'Abrir ficha no Maps ↗':'Conferir no Maps ↗',googleMapsUrl(l,googleCheck)),anchor('Buscar na web ↗','https://www.google.com/search?q='+encodeURIComponent(query)),anchor('Cardápio, pedidos e redes ↗','https://www.google.com/search?q='+encodeURIComponent(query+' site cardápio pedidos Instagram Facebook')));
 if(canProspect(editingLead))links.append(linksFor(editingLead));links.append(anchor('Fonte OSM ↗',l.sourceUrl));$('lead-links').replaceChildren(links);updateReviewForm();$('lead-dialog').showModal();render();
}
function updateReviewForm(){const value=$('lead-verified').value,missing=value==='missing'&&!editingLead?.ignored;$('verification-checklist').hidden=!missing;$('review-url-label').hidden=value!=='exists';$('lead-review-url').disabled=value!=='exists';for(const id of ['review-maps','review-web','review-confirm'])$(id).required=missing;
 $('lead-stage').disabled=!missing;$('lead-followup').disabled=!missing;$('lead-save').textContent=value==='exists'?'Excluir da prospecção':missing?'Salvar oportunidade':'Salvar revisão';$('lead-review-note').textContent=value==='exists'?'Use esta opção quando houver site, cardápio, pedidos ou reservas. Redes sociais, sozinhas, não eliminam o candidato.':missing?'Confirme os três itens. Facebook e Instagram são permitidos; site, cardápio e sistema de pedidos contam como solução online.':'Ainda não conferido: continua candidato. Redes sociais podem indicar uma oportunidade de melhorar a presença online.';
 if(editingLead?.ignored){$('lead-save').textContent='Salvar revisão ignorada';$('lead-review-note').textContent='Ignorado por você. Use “Voltar a verificar” na lista de ignorados para liberar este estabelecimento novamente.';}
}
window.prospectaReviewCandidate=id=>{const lead=[...results,...saved].map(merged).find(item=>item.id===id);if(!lead)return false;if(googleViewShown){pendingReviewId=id;window.prospectaReturnToList();}else{if($('lead-dialog').open)$('lead-dialog').close();openLead(lead);}return true;};
function setView(next,presence='qualified'){view=next;selectedId='';$('name-filter').value='';if(next==='saved')$('presence-filter').value=presence;render();}
function readCache(key){try{const cache=JSON.parse(localStorage.getItem(CACHE)||'[]');return cache.find(x=>x.key===key&&Date.now()-x.time<15*60*1000);}catch{return null;}}
function writeCache(key,elements){try{const old=JSON.parse(localStorage.getItem(CACHE)||'[]').filter(x=>x.key!==key&&Date.now()-x.time<15*60*1000).slice(0,2);localStorage.setItem(CACHE,JSON.stringify([{key,time:Date.now(),elements},...old]));}catch{/* A full cache must never block CRM saves. */try{localStorage.removeItem(CACHE);}catch{}}}
async function search(event){
 event?.preventDefault();if(busy)return;const area=selectedArea();if(!area){toast('Escolha um centro válido no mapa.');return;}const key=searchAreaKey(area),cached=readCache(key);if(!cached&&Date.now()-lastSearch<10000){toast('Aguarde alguns segundos entre buscas.');return;}
 pendingListScroll=$('results').scrollTop;busy=true;for(const id of ['search-button','niche','radius','city','go-city','use-map-center'])$(id).disabled=true;updateSearchArea();render();if(map&&areaCircle)map.fitBounds(areaCircle.getBounds(),{padding:[35,35],maxZoom:15});let partial=false;
 try{
  let elements;
  if(cached)elements=cached.elements;
  else{lastSearch=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);try{const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:queryFor(area.niche,area.lat,area.lon,area.radius)}),signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin'});if(!response.ok)throw new Error(response.status===429?'O serviço está ocupado. Aguarde e tente mais tarde.':'O serviço de mapas não respondeu ('+response.status+'). Tente novamente mais tarde.');const data=await response.json();if(!Array.isArray(data.elements))throw new Error('A fonte retornou dados inesperados.');elements=data.elements;partial=!!data.remark;if(!partial)writeCache(key,elements);}finally{clearTimeout(timer);}}
  const context=searchContext(area,cities),stamp=new Date(cached?.time||Date.now()).toISOString();
  results=uniqueLeads(elements.map(e=>normalizeElement(e,context)).filter(Boolean).map(lead=>({...lead,fetchedAt:stamp})));pendingListScroll=0;searched=true;searchedAt=stamp;searchedArea=area;view='discover';$('name-filter').value='';
  let changed=false;saved=saved.map(own=>{const fresh=results.find(l=>sameBusiness(l,own));if(!fresh)return own;const next={...combineEvidence(own,fresh),id:own.id,sourceUrl:own.sourceUrl,stage:own.stage,verified:own.verified,reviewedAt:own.reviewedAt,reviewUrl:own.reviewUrl,ignored:own.ignored===true,ignoredAt:own.ignoredAt||'',followup:own.followup,notes:own.notes};if(JSON.stringify(next)!==JSON.stringify(own))changed=true;return next;});if(changed)persist();
  const pool=results.map(merged),pending=pool.filter(l=>!l.ignored&&digitalPresence(l).status==='unknown').length,excluded=pool.filter(l=>!l.ignored&&digitalPresence(l).status==='exists').length;toast(partial?'Busca parcial. Reduza o raio para tentar novamente.':(cached?'Busca do cache. ':'')+countLabel(pool.filter(canProspect).length,'oportunidade','oportunidades')+' · '+pending+' para verificar · '+excluded+' com site ou solução online.');
 }catch(error){toast(error.name==='AbortError'?'A busca demorou demais. Reduza o raio ou tente mais tarde.':error.message||'Não foi possível buscar. Tente mais tarde.');}
 finally{busy=false;for(const id of ['search-button','niche','radius'])$(id).disabled=false;$('city').disabled=!cities.length;updateSearchArea();render();}
}
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
for(const stage of STAGES){$('lead-stage').append(new Option(stage,stage));$('stage-filter').append(new Option(stage,stage));}
$('search-form').addEventListener('submit',search);$('discover-tab').addEventListener('click',()=>setView('discover'));$('review-tab').addEventListener('click',()=>setView('review'));$('saved-tab').addEventListener('click',()=>setView('saved'));
$('show-ignored').addEventListener('click',()=>{$('stage-filter').value='';$('contact-only').checked=false;setView('saved','ignored');});
for(const id of ['contact-only','stage-filter','presence-filter','sort'])$(id).addEventListener('change',render);$('name-filter').addEventListener('input',render);$('fit-map').addEventListener('click',fitMap);
$('lead-verified').addEventListener('change',updateReviewForm);$('lead-review-url').addEventListener('input',()=>$('lead-review-url').setCustomValidity(''));
$('google-review').addEventListener('click',()=>openGoogle(googleCandidates()));$('lead-google').addEventListener('click',()=>{if(editingLead)openGoogle([editingLead],{runSingle:true});});
$('lead-recheck').addEventListener('click',()=>{rechecking=true;$('lead-recheck').hidden=true;for(const id of ['review-maps','review-web','review-confirm'])$(id).checked=false;$('lead-review-note').textContent='Nova conferência: consulte Maps e web novamente e confirme os três itens para atualizar a data.';$('verification-checklist').scrollIntoView({block:'nearest',behavior:'smooth'});});
$('lead-close').addEventListener('click',()=>$('lead-dialog').close());$('lead-dialog').addEventListener('close',()=>{if(pendingReviewId&&!googleViewShown){const id=pendingReviewId;pendingReviewId='';queueMicrotask(()=>{const lead=[...results,...saved].map(merged).find(item=>item.id===id);if(lead)openLead(lead);});}});$('lead-form').addEventListener('submit',e=>{
 e.preventDefault();if(!editingLead||!editingForm)return;const current=saved.find(s=>sameBusiness(s,editingLead))||editingLead,choice=$('lead-verified').value,rawUrl=$('lead-review-url').value.trim(),chosenUrl=choice==='exists'?safeUrl(rawUrl):'';
 if(choice==='exists'&&rawUrl&&!chosenUrl){$('lead-review-url').setCustomValidity('Use um link http:// ou https:// da solução encontrada.');$('lead-review-url').reportValidity();return;}
 if(choice==='exists'&&chosenUrl&&classifyWebsite(chosenUrl)!=='solution'){$('lead-review-url').setCustomValidity('Um perfil social ou agregador de links, sozinho, não elimina o candidato. Confira se há site, cardápio ou pedidos.');$('lead-review-url').reportValidity();return;}
 const changedReview=rechecking||choice!==editingForm.verified||rawUrl!==editingForm.reviewUrl,verified=changedReview?choice:current.verified,reviewUrl=changedReview?chosenUrl:current.reviewUrl,reviewedAt=changedReview?(verified==='unknown'?'':new Date().toISOString()):current.reviewedAt;
 const next={...current,verified,reviewUrl,reviewedAt,reviewScope:changedReview?'website':current.reviewScope,stage:!$('lead-stage').disabled&&$('lead-stage').value!==editingForm.stage?$('lead-stage').value:current.stage,followup:!$('lead-followup').disabled&&$('lead-followup').value!==editingForm.followup?$('lead-followup').value:current.followup,notes:$('lead-notes').value!==editingForm.notes?$('lead-notes').value.trim():current.notes};
 if(verified==='missing'&&!next.ignored&&(!['review-maps','review-web','review-confirm'].every(id=>$(id).checked)||!canProspect(next))){toast('Confira Maps e web e confirme os três itens. Um site ou solução online identificado impede a qualificação.');return;}
 const index=saved.findIndex(s=>s.id===next.id);if(index<0)saved.push(next);else saved[index]=next;const ok=persist();if(ok)$('lead-dialog').close();render();if(ok)toast(verified==='exists'?'Excluído da prospecção. A solução encontrada ficou registrada.':canProspect(next)?'Revisão salva. O negócio está disponível em Oportunidades.':'Revisão salva. O negócio continua sem qualificação para contato.');
});
$('lead-remove').addEventListener('click',()=>{const previous=saved;saved=saved.filter(s=>s.id!==selectedId);if(!persist()){saved=previous;render();return;}$('lead-dialog').close();render();toast('Revisão removida. Sem uma revisão, o negócio não fica qualificado para contato.');});
$('export-csv').addEventListener('click',()=>{const scope=view==='review'?'candidatos':view==='saved'&&$('presence-filter').value==='ignored'?'ignorados':view==='saved'&&$('presence-filter').value==='all'?'revisoes':'oportunidades';if(visible.length)download('prospecta-'+scope+'-'+new Date().toISOString().slice(0,10)+'.csv',toCsv(visible),'text/csv;charset=utf-8');});
$('backup').addEventListener('click',()=>{if(!storageAvailable&&!crmDirty){try{const original=localStorage.getItem(STORAGE);if(original){download('prospecta-backup-original.json',original,'application/json');toast('Arquivo original exportado para recuperação, sem substituir os dados.');return;}}catch{}toast('Não foi possível acessar a lista original. Nenhum backup vazio foi exportado.');return;}download('prospecta-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),attribution:'© colaboradores do OpenStreetMap, ODbL',leads:saved,workspace:normalizeWorkspace(captureWorkspace())},null,2),'application/json');});
$('restore').addEventListener('click',()=>$('restore-file').click());$('restore-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('O arquivo excede 10 MB.');const data=JSON.parse(await file.text()),imported=validateBackup(data),importedWorkspace=normalizeWorkspace(data.workspace);let added=0;for(const l of imported){const index=saved.findIndex(own=>sameBusiness(own,l));if(index<0){saved.push(l);added++;}else{const own=saved[index],exists=digitalPresence(own).status==='exists'||digitalPresence(l).status==='exists',ignored=own.ignored===true||l.ignored===true;saved[index]={...own,website:own.website||l.website,instagram:own.instagram||l.instagram,presenceLinks:mergePresenceLinks(digitalPresence(own).urls,digitalPresence(l).urls),verified:exists?'exists':own.verified,reviewScope:exists?(digitalPresence(own).status==='exists'?own:l).reviewScope:own.reviewScope,ignored,ignoredAt:ignored?(own.ignoredAt||l.ignoredAt||''):''};}}const ok=persist();if(ok&&importedWorkspace){restoreWorkspace(importedWorkspace);flushWorkspace();}else setView('saved');if(ok)toast(added+' revisões importadas. Notas, etapas e estabelecimentos ignorados foram preservados; evidências de presença foram combinadas.');}catch(error){toast(error.message||'Arquivo inválido.');}finally{e.target.value='';}});
for(const id of ['help-open','about-data'])$(id).addEventListener('click',()=>$('help-dialog').showModal());for(const id of ['help-close','help-done'])$(id).addEventListener('click',()=>$('help-dialog').close());
$('city').addEventListener('input',()=>{const q=fold($('city').value);$('cities-list').replaceChildren(...cities.filter(c=>fold(c.name+' '+c.uf).includes(q)).slice(0,15).map(c=>new Option(c.name+' · '+c.uf)));});
$('go-city').addEventListener('click',goToCity);$('city').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();goToCity();}});$('city').addEventListener('change',()=>{if(cities.some(c=>fold(c.name+' · '+c.uf)===fold($('city').value)))goToCity();});
$('use-map-center').addEventListener('click',()=>{if(!map||busy)return;const point=map.getCenter().wrap();setSearchCenter({lat:point.lat,lon:point.lng,label:'Ponto no mapa',mode:'map'});});
for(const id of ['niche','radius'])$(id).addEventListener('change',()=>{updateSearchArea();scheduleWorkspaceSave();});
$('city').addEventListener('input',scheduleWorkspaceSave);
function reloadSaved(){if(crmDirty)return;const next=leadStore?.load();if(next?.ok){saved=next.leads;storageAvailable=true;}else{storageAvailable=false;$('local-state').textContent='Não foi possível ler a lista salva. Os dados existentes foram preservados.';}render();}
$('search-form').addEventListener('input',scheduleWorkspaceSave);$('search-form').addEventListener('change',scheduleWorkspaceSave);$('results').addEventListener('scroll',scheduleWorkspaceSave,{passive:true});
window.addEventListener('pagehide',()=>flushWorkspace());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushWorkspace();});
window.addEventListener('storage',event=>{if(event.key===GOOGLE_HISTORY_KEY){googleHistory=loadGoogleHistory().entries;render();}if(event.key===STORAGE)reloadSaved();});window.addEventListener('pageshow',event=>{if(event.persisted){googleHistory=loadGoogleHistory().entries;reloadSaved();render();}});
window.addEventListener('popstate',updateGoogleView);window.addEventListener('hashchange',updateGoogleView);
setupMap();if(restoredWorkspace)restoreWorkspace(restoredWorkspace);else{updateSearchArea();render();}if(map)map.on('moveend zoomend',scheduleWorkspaceSave);googleStatus();
if(!storageAvailable){$('local-state').textContent='Não foi possível ler a lista local. Os dados originais foram preservados.';toast('A lista salva não pôde ser lida. Nenhuma gravação substituirá os dados originais.');}
try{
 const response=await fetch(new URL('./cities.json',import.meta.url));if(!response.ok)throw new Error();cities=await response.json();currentCity=currentCity||cities.find(c=>c.name==='Jaraguá do Sul'&&c.uf==='SC');
 $('cities-list').replaceChildren(...cities.filter(c=>['Jaraguá do Sul','Joinville','Florianópolis','São Paulo','Curitiba'].includes(c.name)).slice(0,15).map(c=>new Option(c.name+' · '+c.uf)));$('city').disabled=false;$('go-city').disabled=false;
 if(!restoredWorkspace?.searched&&!results.length){if(recoverPreviousSearch())toast('Última busca recuperada neste navegador. Os dados mantêm a data da consulta anterior.');else if(!restoredWorkspace&&saved.length){view='saved';$('presence-filter').value='all';}}
}catch{toast('O atalho de cidades está indisponível. Escolha o centro no mapa; a busca e os dados salvos continuam disponíveis.');}
finally{workspaceReady=true;$('search-button').disabled=busy;updateSearchArea();render();flushWorkspace();updateGoogleView();}
