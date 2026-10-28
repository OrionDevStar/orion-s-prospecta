import {sameBusiness,validateBackup,classifyWebsite} from './domain.mjs';
import {createLeadStore} from './lead-store.mjs';
import {GOOGLE_HISTORY_KEY,loadGoogleHistory,recordGoogleCheck,getGoogleCheck,googleMapsUrl} from './google-history.mjs';
import {normalizeGoogleResult} from './google-results.mjs';
import {needsGoogleCheck} from './google-queue.mjs';

if(window.parent===window){
 // Old bookmarks and direct links enter the same application view in this tab.
 location.replace(new URL('./#google',import.meta.url));
}else{
const $=id=>document.getElementById(id),CANDIDATES_KEY='prospecta-google-candidates-v1';
const results=new Map(),attempted=new Set(),selected=new Set();
let usage=null,statusReady=false,busy=false,stopRequested=false,leaving=false,activeId='',activeController=null;
let googleHistory=loadGoogleHistory().entries;
function savedRecords(){try{const result=createLeadStore({storage:localStorage}).load();return result.ok?result.leads:null;}catch{return null;}}

function readEntry(payload){
 try{
  const raw=payload??JSON.parse(sessionStorage.getItem(CANDIDATES_KEY)||'[]'),list=Array.isArray(raw)?raw:raw?.candidates;
  if(!Array.isArray(list))return {candidates:[],selectedIds:[],runSingleId:''};
  const seen=new Set();
  const candidates=list.slice(0,600).filter(item=>item&&typeof item==='object'&&typeof item.id==='string'&&/^osm:(node|way|relation):\d+$/.test(item.id)&&typeof item.name==='string'&&item.name.trim()&&typeof item.city==='string'&&item.city.trim()&&typeof item.lat==='number'&&Number.isFinite(item.lat)&&Math.abs(item.lat)<=90&&typeof item.lon==='number'&&Number.isFinite(item.lon)&&Math.abs(item.lon)<=180).filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).map(item=>({id:item.id,name:item.name.slice(0,300),city:item.city.slice(0,150),address:String(item.address||'').slice(0,500),lat:item.lat,lon:item.lon,phoneNumber:String(item.phoneNumber||'').replace(/\D/g,'').slice(0,15),category:String(item.category||'Negócio local').slice(0,100),distance:Number.isFinite(item.distance)?item.distance:0,fetchedAt:String(item.fetchedAt||'').slice(0,40)}));
  const selectedIds=Array.isArray(raw?.selectedIds)?[...new Set(raw.selectedIds.slice(0,600).filter(id=>typeof id==='string'&&seen.has(id)))]:[];
  let runSingleId=!Array.isArray(raw)&&raw?.runSingle===true&&selectedIds.length===1?selectedIds[0]:'';
  if(!Array.isArray(raw)||payload){
   // Consume the explicit request before consulting: reload must never repeat it.
   try{sessionStorage.setItem(CANDIDATES_KEY,JSON.stringify(candidates));}catch{runSingleId='';}
  }
  return {candidates,selectedIds,runSingleId};
 }catch{return {candidates:[],selectedIds:[],runSingleId:''};}
}
const entry=readEntry(),candidates=entry.candidates;
for(const id of entry.selectedIds)selected.add(id);
function localApp(){try{if(window.parent!==window&&window.parent.location.origin===location.origin)return window.parent;}catch{}return null;}
function liveSession(){return localApp()?.prospectaGoogleSession||null;}
function syncLiveResults(){const session=liveSession();if(session)for(const [id,result] of results)session.set(id,result);}
function restoreLiveResults(){const session=liveSession();if(!session)return;for(const candidate of candidates){const result=normalizeGoogleResult(session.get(candidate.id));if(result){results.set(candidate.id,result);attempted.add(candidate.id);selected.delete(candidate.id);}}syncLiveResults();}
restoreLiveResults();
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function safeUrl(value){try{const url=new URL(String(value||''));return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function anchor(label,value){const url=safeUrl(value);if(!url)return null;const link=node('a','',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;}
function displayName(place){return typeof place?.displayName==='string'?place.displayName:place?.displayName?.text||'';}
function remaining(){if(!usage?.enabled||usage.blocked)return 0;const limits=[usage.monthly,usage.daily,usage.rolling];if(limits.some(limit=>!limit||!Number.isFinite(limit.remaining)||!Number.isFinite(limit.limit)||limit.limit<0))return 0;return Math.max(0,Math.min(...limits.map(limit=>limit.remaining)));}
function visibleCandidates(saved=savedRecords()){return candidates.filter(candidate=>needsGoogleCheck(candidate,saved));}
function unattempted(saved=savedRecords()){return visibleCandidates(saved).filter(candidate=>!attempted.has(candidate.id));}
function selectedCandidates(saved=savedRecords()){return unattempted(saved).filter(candidate=>selected.has(candidate.id));}
function announce(message){$('batch-status').textContent=message;}
function showError(message){$('page-error').textContent=message;$('page-error').hidden=!message;}
function formatCount(count,label){return count+' '+label+(count===1?'':'s');}
function applyUsage(next){if(next&&typeof next==='object'){usage=next;statusReady=true;}renderUsage();renderControls();}
function renderUsage(){
 for(const [name,fallback] of [['monthly',900],['daily',25],['rolling',900]]){
  const item=usage?.[name],used=Number.isFinite(item?.used)?item.used:null,limit=Number.isFinite(item?.limit)?item.limit:fallback;
  $(name+'-usage').textContent=used===null?'—':used.toLocaleString('pt-BR')+' de '+limit.toLocaleString('pt-BR');
  $(name+'-progress').max=Math.max(1,limit);$(name+'-progress').value=used??0;
 }
 if(!statusReady)return;
 if(!usage?.enabled)$('places-status').textContent='Integração indisponível. Configure PLACESAPI no .env e reinicie o servidor local.';
 else if(usage.blocked||remaining()===0){
  const messages={daily_limit:'Limite diário atingido. Novas consultas estão bloqueadas.',monthly_limit:'Limite mensal atingido. Novas consultas estão bloqueadas.',rolling_limit:'Limite dos últimos 32 dias atingido. Novas consultas estão bloqueadas.',clock_changed:'O relógio retrocedeu. Confira o horário do servidor antes de consultar.',not_configured:'Configure PLACESAPI no .env e reinicie o servidor.'},reset=Date.parse(usage.nextResetAt);
  let message=messages[usage.blockReason]||'Limite de consultas atingido. Novas consultas estão bloqueadas.';
  if(['daily_limit','monthly_limit','rolling_limit'].includes(usage.blockReason)&&Number.isFinite(reset))message+=' Retomada prevista: '+new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(reset)+' (Brasília).';
  $('places-status').textContent=message;
 }
 else $('places-status').textContent=formatCount(remaining(),'consulta')+(remaining()===1?' disponível':' disponíveis')+' antes do próximo bloqueio.';
 if(usage?.enabled){const monthly=usage.monthly?.limit??900,daily=usage.daily?.limit??25,rolling=usage.rolling?.limit??900;$('limit-note').textContent='Proteção desta instalação: até '+monthly+' chamadas no mês, '+daily+' por dia e '+rolling+' em qualquer período de 32 dias. As tentativas também são contabilizadas. Os créditos de teste não ampliam esses limites.';}
}
function renderControls(){
 const saved=savedRecords(),choices=selectedCandidates(saved),available=statusReady&&!busy&&remaining()>0&&choices.length>0;
 $('verify-next').disabled=!available;$('verify-batch').disabled=!available;$('refresh-status').disabled=busy;$('cancel-batch').hidden=!busy;$('cancel-batch').disabled=stopRequested;
 $('selection-count').textContent=formatCount(choices.length,'selecionado');$('select-all').disabled=!unattempted(saved).some(candidate=>!selected.has(candidate.id));$('clear-selection').disabled=!choices.length;
 const batchSize=Math.min(5,choices.length,remaining());$('verify-batch').textContent=batchSize?'Consultar selecionados ('+batchSize+')':'Consultar selecionados';
 for(const checkbox of document.querySelectorAll('.candidate-checkbox')){checkbox.checked=selected.has(checkbox.dataset.candidateId);checkbox.disabled=attempted.has(checkbox.dataset.candidateId);}
 for(const button of document.querySelectorAll('.consult-google'))button.disabled=busy||!statusReady||remaining()<=0||attempted.has(button.dataset.candidateId);
 for(const button of document.querySelectorAll('.refresh-result'))button.disabled=busy||!statusReady||remaining()<=0||!needsGoogleCheck(candidates.find(candidate=>candidate.id===button.dataset.candidateId),saved);
}
function attributionsFor(place){const wrap=node('p','provider-attributions');wrap.append(document.createTextNode('Google Maps'));for(const item of Array.isArray(place?.attributions)?place.attributions:[]){const label=String(item.provider||'').slice(0,300);if(!label)continue;wrap.append(document.createTextNode(' · '));const link=anchor(label,item.providerUri);wrap.append(link||document.createTextNode(label));}return wrap;}
function placeDetails(place){
 const section=node('div','google-result'),name=displayName(place);if(name){const title=node('p');title.append(node('strong','',name));section.append(title);}
 if(place.formattedAddress)section.append(node('p','',String(place.formattedAddress)));
 const operation={OPERATIONAL:'Em operação',CLOSED_PERMANENTLY:'Fechado permanentemente',CLOSED_TEMPORARILY:'Fechado temporariamente'}[place.businessStatus];if(operation)section.append(node('p','business-status','Funcionamento cadastrado: '+operation+'.'));
 if(place.phoneNumber)section.append(node('p','','Telefone cadastrado: +'+place.phoneNumber));
 const kind=classifyWebsite(place.websiteUri),links=node('div','result-links'),site=anchor(kind==='social'?'Abrir perfil social ↗':kind==='links'?'Conferir página de links ↗':'Abrir site cadastrado ↗',place.websiteUri),maps=anchor('Conferir no Google Maps ↗',place.googleMapsUri);if(site)links.append(site);if(maps)links.append(maps);if(links.childElementCount)section.append(links);section.append(attributionsFor(place));return section;
}
function applyDecision(candidate,ignored){
 try{
  const store=createLeadStore({storage:localStorage}),current=store.load();if(!current.ok){showError(current.error);return false;}
  let found=false;const leads=current.leads.map(lead=>{if(!sameBusiness(lead,candidate))return lead;found=true;return {...lead,ignored,ignoredAt:ignored?new Date().toISOString():''};});
  // The user's decision refers to the original OSM candidate, not a copy of Places data.
  if(!found)leads.push(validateBackup({version:1,leads:[{...candidate,ignored,ignoredAt:ignored?new Date().toISOString():'',verified:'unknown',stage:'Revisar'}]})[0]);
  const written=store.save(leads);if(!written.ok){showError(written.error);return false;}
  showError('');renderCandidates();
  announce(ignored?'Decisão salva. O estabelecimento saiu da fila. Você pode desfazer em Ignorados.':'Salvo na Minha lista e retirado da consulta Google. Suas notas e revisões foram preservadas.');
  return true;
 }catch{showError('Não foi possível salvar sua decisão. Os dados anteriores foram preservados.');return false;}
}
function cardFor(candidate){
 const result=results.get(candidate.id),check=getGoogleCheck(candidate,googleHistory),card=node('article','candidate-card'+(candidate.id===activeId?' is-active':''));card.dataset.id=candidate.id;
 const heading=node('div','card-heading'),identity=node('div','candidate-identity');
 if(!attempted.has(candidate.id)){
  const label=node('label','candidate-select'),checkbox=node('input','candidate-checkbox');checkbox.type='checkbox';checkbox.checked=selected.has(candidate.id);checkbox.dataset.candidateId=candidate.id;checkbox.dataset.focus='select:'+candidate.id;checkbox.setAttribute('aria-label','Selecionar '+candidate.name+' para consultar no Google');
  checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(candidate.id);else selected.delete(candidate.id);renderControls();});label.append(checkbox,node('span','','Selecionar para consulta'));identity.append(label);
 }
 identity.append(node('h3','',candidate.name),node('p','candidate-location',candidate.city),node('p','candidate-location',candidate.address||'Endereço não informado na fonte'));heading.append(identity);
 let badge='Aguardando consulta',className='badge',detail='A presença digital deste negócio ainda não foi conferida.';
 if(candidate.id===activeId){badge='Consultando…';detail='Conferindo o estabelecimento e o site cadastrado.';}
 else if(result?.status==='found_website'){badge='Site identificado';className+=' excluded';detail='Foi encontrado um site para o estabelecimento correspondente. Use “Ignorar na minha lista” para retirá-lo da sua fila.';}
 else if(result?.status==='closed_permanently'){badge='Fechado permanentemente';className+=' closed';detail='O Google informa que este estabelecimento fechou permanentemente. Use “Ignorar na minha lista” para retirá-lo da sua fila.';}
 else if(result?.status==='closed_temporarily'){badge='Fechado temporariamente';className+=' closed';detail='O Google informa fechamento temporário. Você pode ignorá-lo na sua lista e conferir uma possível reabertura mais tarde.';}
 else if(result?.status==='social_only'){badge='Rede social · potencial oportunidade';className+=' checked';detail='O link cadastrado é um perfil social, não um site ou sistema de pedidos. Facebook e Instagram não eliminam este candidato; confira se existe outra solução antes de concluir a revisão.';}
 else if(result?.status==='links_only'){badge='Página de links · conferir';className+=' checked';detail='O link cadastrado reúne outros links. Confira os destinos para saber se há site, cardápio ou pedidos. Esse link, sozinho, não elimina o candidato.';}
 else if(result?.status==='no_website_listed'){badge='Sem site cadastrado · pendente';className+=' checked';detail='O Google não informou um site. Confira cardápio, pedidos e redes antes de considerar uma abordagem.';}
 else if(result?.status==='ambiguous'){badge='Identificação incerta · pendente';className+=' checked';detail='A correspondência não foi suficientemente clara. Confira o nome, o endereço e a localização antes de concluir.';}
 else if(result?.status==='not_found'){badge='Não localizado · pendente';className+=' checked';detail='Não foi localizado um estabelecimento correspondente nesta consulta. Isso não comprova ausência de presença digital.';}
 else if(result?.status==='error'){badge='Consulta interrompida';className+=' error';detail=result.message||'Não foi possível concluir a consulta. Nenhuma conclusão foi registrada.';}
 else if(check){badge='Consulta anterior';detail='Abra a ficha no Maps para rever o cadastro. Buscar dados atualizados pela API exige uma nova consulta explícita.';}
 heading.append(node('span',className,badge));card.append(heading,node('p','result-detail',detail));
 if(check){const history=node('div','consultation-history');history.append(node('p','','Consultado em '+new Date(check.checkedAt).toLocaleString('pt-BR')+(result?'':'. Os detalhes desta consulta anterior não estão disponíveis. Abra a ficha no Maps sem gastar API.')));const link=anchor(check.placeId?'Abrir ficha no Maps ↗':'Buscar no Maps ↗',googleMapsUrl(candidate,check));if(link){link.className='google-profile-link';link.title='Abre o Google Maps sem consumir uma consulta da API';history.append(link);}card.append(history);}
 if(result?.place)card.append(placeDetails(result.place));
 if(result?.status==='ambiguous'&&Array.isArray(result.alternatives)&&result.alternatives.length){const section=node('div','google-result');section.append(node('p','', 'Possíveis correspondências, ainda não confirmadas:'));const list=node('ul','alternative-list');for(const place of result.alternatives.slice(0,3)){const item=node('li'),name=displayName(place)||'Estabelecimento',link=anchor(name+' ↗',place.googleMapsUri);item.append(link||document.createTextNode(name));if(place.formattedAddress)item.append(document.createTextNode(' · '+String(place.formattedAddress)));const closure={CLOSED_PERMANENTLY:'Fechado permanentemente',CLOSED_TEMPORARILY:'Fechado temporariamente'}[place.businessStatus];if(closure)item.append(node('span','alternative-closure',closure+' no cadastro desta possível correspondência'));item.append(attributionsFor(place));list.append(item);}section.append(list);card.append(section);}
 const actions=node('div','candidate-actions');
 if(!attempted.has(candidate.id)){const button=node('button','secondary consult-google',check?'Consultar novamente (1 chamada)':'Consultar Google');button.type='button';button.dataset.candidateId=candidate.id;button.dataset.focus='verify:'+candidate.id;button.addEventListener('click',()=>verifySingle(candidate));actions.append(button);}
 if(result){const refresh=node('button','text-button refresh-result','Atualizar dados (1 chamada)');refresh.type='button';refresh.dataset.candidateId=candidate.id;refresh.dataset.focus='refresh:'+candidate.id;refresh.addEventListener('click',()=>{if(busy||remaining()<=0)return;attempted.delete(candidate.id);verifySingle(candidate);});actions.append(refresh);}
 const keep=node('button','secondary keep-candidate','Salvar na Minha lista');keep.type='button';keep.dataset.focus='keep:'+candidate.id;keep.addEventListener('click',()=>applyDecision(candidate,false));actions.append(keep);
 if(result&&liveSession()){const review=node('button','secondary review-in-list','Concluir revisão na lista');review.type='button';review.dataset.focus='review:'+candidate.id;review.addEventListener('click',()=>{if(!applyDecision(candidate,false))return;try{localApp()?.prospectaReviewCandidate?.(candidate.id);}catch{showError('Abra a revisão deste candidato na busca local para concluir.');}});actions.append(review);}
 const ignore=node('button','secondary ignore-candidate','Ignorar na minha lista');ignore.type='button';ignore.dataset.focus='ignore:'+candidate.id;ignore.addEventListener('click',()=>applyDecision(candidate,true));actions.append(ignore);
 card.append(actions);
 return card;
}
function renderCandidates(){
 const focusKey=document.activeElement?.dataset?.focus,anchorId=activeId||document.activeElement?.closest('.candidate-card')?.dataset?.id,previousAnchor=anchorId?[...document.querySelectorAll('.candidate-card')].find(card=>card.dataset.id===anchorId):null,anchorTop=previousAnchor?.getBoundingClientRect().top,scrollY=window.scrollY,saved=savedRecords(),activeCandidates=visibleCandidates(saved),activeIds=new Set(activeCandidates.map(candidate=>candidate.id));
 for(const id of selected)if(!activeIds.has(id))selected.delete(id);
 const waiting=unattempted(saved).length,completed=activeCandidates.filter(candidate=>results.has(candidate.id)).length;$('candidate-count').textContent=activeCandidates.length;$('queue-summary').textContent=!saved?'Não foi possível conferir Minha lista. As consultas estão bloqueadas.':activeCandidates.length?formatCount(completed,'resultado')+' nesta aba · '+formatCount(waiting,'candidato')+' disponível para consulta. Negócios salvos na Minha lista ficam fora desta fila.':'Nenhum candidato novo. Negócios salvos na Minha lista não aparecem para consultar novamente.';
 $('candidates-list').replaceChildren(...activeCandidates.map(cardFor));
 if(!activeCandidates.length){const empty=node('div','empty-state');empty.append(node('h3','',saved?'Nenhum candidato novo':'Minha lista indisponível'),node('p','',saved?'Faça outra busca local para encontrar negócios que ainda não estão na Minha lista.':'Não foi possível conferir os registros salvos. Nenhum candidato será enviado ao Google até a leitura ser válida.'));const link=node('a','','Voltar à busca local');link.href='./';empty.append(link);$('candidates-list').append(empty);}
 renderControls();
 if(focusKey){const focus=[...document.querySelectorAll('[data-focus]')].find(element=>element.dataset.focus===focusKey&&!element.disabled);focus?.focus({preventScroll:true});}
 if(Number.isFinite(anchorTop)){const nextAnchor=[...document.querySelectorAll('.candidate-card')].find(card=>card.dataset.id===anchorId);if(nextAnchor)window.scrollTo({top:Math.max(0,scrollY+nextAnchor.getBoundingClientRect().top-anchorTop),behavior:'instant'});}
}
async function refreshStatus({preserveError=false,allowBusy=false}={}){
 if(busy&&!allowBusy)return;$('refresh-status').disabled=true;if(!preserveError)showError('');
 try{const response=await fetch('/api/places/status',{cache:'no-store',headers:{Accept:'application/json'}}),body=await response.json();if(!response.ok)throw new Error(body.error?.message||'Não foi possível conferir o limite de consultas.');applyUsage(body);}
 catch(error){statusReady=false;usage=null;renderUsage();$('places-status').textContent='Não foi possível confirmar o consumo. Novas consultas estão bloqueadas.';if(!preserveError||!$('page-error').textContent)showError('Não foi possível conferir o limite de consultas. Use o servidor local atualizado do Prospecta.');}
 finally{renderControls();$('refresh-status').disabled=busy;}
}
async function verifyBatch(size,requested=null){
 if(busy||!statusReady||remaining()<=0)return;const saved=savedRecords(),batch=(requested||selectedCandidates(saved)).filter(candidate=>needsGoogleCheck(candidate,saved)&&!attempted.has(candidate.id)&&selected.has(candidate.id)).slice(0,Math.min(size,5,remaining()));if(!batch.length)return;
 busy=true;stopRequested=false;showError('');let completed=0;
 try{
  for(const candidate of batch){
   if(stopRequested||remaining()<=0)break;const latest=savedRecords();if(!latest){showError('Não foi possível conferir Minha lista. As próximas consultas foram bloqueadas.');stopRequested=true;break;}if(!selected.has(candidate.id)||!needsGoogleCheck(candidate,latest)){selected.delete(candidate.id);continue;}activeId=candidate.id;selected.delete(candidate.id);attempted.add(candidate.id);announce('Consultando '+candidate.name+'… '+(completed+1)+' de '+batch.length+'.');renderCandidates();
   activeController=new AbortController();const timer=setTimeout(()=>activeController?.abort(),20000);
   try{
    const response=await fetch('/api/places/verify',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-Prospecta-Request':'places-v1'},body:JSON.stringify({candidate}),signal:activeController.signal,cache:'no-store'}),body=await response.json();
    if(body.usage)applyUsage(body.usage);if(!response.ok)throw new Error(body.error?.message||'A consulta não pôde ser concluída.');
    const result=normalizeGoogleResult(body);if(!result||result.status==='error')throw new Error('A integração retornou uma resposta inesperada. A sequência foi interrompida.');
    if(leaving)break;results.set(candidate.id,result);syncLiveResults();completed++;
    const check=recordGoogleCheck({id:candidate.id,checkedAt:new Date().toISOString(),placeId:['found_website','social_only','links_only','no_website_listed','closed_permanently','closed_temporarily'].includes(result.status)?result.place?.id:''});
    if(check.ok)googleHistory=check.entries;else showError(check.error);
   }catch(error){const message=error.name==='AbortError'?'A consulta demorou demais. A tentativa pode ter sido contabilizada; a sequência foi interrompida.':error.message||'Não foi possível consultar. A sequência foi interrompida.';if(!leaving){results.set(candidate.id,{status:'error',message});syncLiveResults();showError(message);}stopRequested=true;}
   finally{clearTimeout(timer);activeController=null;activeId='';renderCandidates();}
  }
 }finally{if(stopRequested&&!leaving)await refreshStatus({preserveError:true,allowBusy:true});busy=false;activeId='';announce((stopRequested?'Sequência interrompida. ':'')+formatCount(completed,'consulta')+(completed===1?' concluída. ':' concluídas. ')+(unattempted().length?'Os próximos candidatos aguardam sua ação.':'Nenhuma consulta adicional será iniciada.'));renderCandidates();}
}
function verifySingle(candidate){if(busy||!statusReady||remaining()<=0||attempted.has(candidate.id)||!needsGoogleCheck(candidate,savedRecords()))return;selected.add(candidate.id);return verifyBatch(1,[candidate]);}
$('verify-next').addEventListener('click',()=>verifyBatch(1));$('verify-batch').addEventListener('click',()=>verifyBatch(5));$('refresh-status').addEventListener('click',()=>refreshStatus());
$('select-all').addEventListener('click',()=>{for(const candidate of unattempted())selected.add(candidate.id);renderControls();});$('clear-selection').addEventListener('click',()=>{selected.clear();renderControls();});
$('cancel-batch').addEventListener('click',()=>{stopRequested=true;announce('Parando após a consulta em andamento. Nenhuma próxima consulta será iniciada.');renderControls();});
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link||link.target==='_blank')return;const home=new URL('./',import.meta.url),url=new URL(link.href);if(url.origin===home.origin&&(url.pathname===home.pathname||url.pathname===home.pathname+'index.html')){const app=localApp();if(app?.prospectaReturnToList){event.preventDefault();app.prospectaReturnToList();}}});
window.addEventListener('pagehide',event=>{leaving=true;stopRequested=true;if(activeId&&!results.has(activeId))results.set(activeId,{status:'error',message:'A consulta foi interrompida ao sair. A tentativa pode ter sido contabilizada; ela não será repetida automaticamente.'});syncLiveResults();activeController?.abort();if(!event.persisted){results.clear();attempted.clear();selected.clear();$('candidates-list').replaceChildren();}});
window.addEventListener('pageshow',event=>{if(event.persisted){leaving=false;busy=false;activeId='';stopRequested=false;renderCandidates();refreshStatus();}});
window.addEventListener('storage',event=>{if(event.key===GOOGLE_HISTORY_KEY)googleHistory=loadGoogleHistory().entries;if(event.key===GOOGLE_HISTORY_KEY||event.key==='orion-prospecta-v1')renderCandidates();});
renderCandidates();
const initialStatus=refreshStatus();
window.prospectaGoogleReceive=async payload=>{
 const incoming=readEntry(payload);for(const candidate of incoming.candidates){const index=candidates.findIndex(item=>item.id===candidate.id);if(index<0)candidates.push(candidate);else if(!results.has(candidate.id))candidates[index]=candidate;}
 try{sessionStorage.setItem(CANDIDATES_KEY,JSON.stringify(candidates.slice(-600)));}catch{showError('Não foi possível guardar os candidatos nesta aba. Mantenha esta página aberta.');}
 for(const id of incoming.selectedIds)if(!attempted.has(id))selected.add(id);
 restoreLiveResults();
 googleHistory=loadGoogleHistory().entries;renderCandidates();
 const focusId=incoming.selectedIds[0];if(focusId){document.querySelector('[data-id="'+focusId+'"]')?.scrollIntoView({block:'center'});}
 if(incoming.runSingleId&&!leaving){await initialStatus;const candidate=candidates.find(item=>item.id===incoming.runSingleId);if(results.has(incoming.runSingleId)){announce('Resultado já disponível nesta aba. Nenhuma nova consulta foi feita.');return;}if(candidate){if(busy)announce('Há uma consulta em andamento. O novo candidato aguarda sua ação.');else verifySingle(candidate);}}
};
localApp()?.prospectaGoogleViewReady?.();
await initialStatus;
if(entry.runSingleId&&!leaving){const candidate=candidates.find(item=>item.id===entry.runSingleId);if(candidate)verifySingle(candidate);}
}
