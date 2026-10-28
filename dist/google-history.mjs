export const GOOGLE_HISTORY_KEY='prospecta-google-history-v1';
const validId=value=>typeof value==='string'&&/^osm:(node|way|relation):\d+$/.test(value);
const placeId=value=>typeof value==='string'&&/^[a-z\d_-]{1,512}$/i.test(value)?value:'';
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return '';
 const instant=Date.parse(value),[year,month,day]=value.slice(0,10).split('-').map(Number);
 if(!Number.isFinite(instant)||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return '';
 return new Date(instant).toISOString();
}

// Only activity timestamps and exempt Place IDs belong here, never Places content.
export function normalizeGoogleHistory(entries){
 if(!Array.isArray(entries)||entries.length>5000)throw new Error('Histórico de consultas inválido.');
 const byId=new Map();
 for(const entry of entries){
  const checkedAt=timestamp(entry?.checkedAt);
  if(!validId(entry?.id)||!checkedAt)throw new Error('Histórico de consultas inválido.');
  const clean={id:entry.id,checkedAt,placeId:placeId(entry.placeId)},previous=byId.get(clean.id);
  if(!previous||clean.checkedAt>=previous.checkedAt)byId.set(clean.id,{...clean,placeId:clean.placeId||previous?.placeId||''});
  else if(!previous.placeId&&clean.placeId)previous.placeId=clean.placeId;
 }
 return [...byId.values()].sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt));
}
export function loadGoogleHistory(storage){
 try{
  storage??=globalThis.localStorage;
  const raw=storage.getItem(GOOGLE_HISTORY_KEY),data=raw===null?{version:1,entries:[]}:JSON.parse(raw);
  if(data?.version!==1)throw new Error();
  return {ok:true,entries:normalizeGoogleHistory(data.entries)};
 }catch{return {ok:false,entries:[],error:'Não foi possível ler o histórico Google. Os dados anteriores foram preservados.'};}
}
export function recordGoogleCheck(check,storage){
 const current=loadGoogleHistory(storage);if(!current.ok)return current;
 let entries;
 try{
  const [clean]=normalizeGoogleHistory([check]),old=current.entries.find(entry=>entry.id===clean.id);
  const merged=old&&old.checkedAt>clean.checkedAt?{...old,placeId:old.placeId||clean.placeId}:{...clean,placeId:clean.placeId||old?.placeId||''};
  entries=[merged,...current.entries.filter(entry=>entry.id!==clean.id)].sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt)).slice(0,5000);
  (storage??globalThis.localStorage).setItem(GOOGLE_HISTORY_KEY,JSON.stringify({version:1,entries}));
  return {ok:true,entries};
 }catch{return {ok:false,entries:current.entries,error:'Não foi possível salvar o histórico Google. Mantenha a tela de resultados aberta para rever esta consulta.'};}
}
export function getGoogleCheck(candidate,entries){return entries.find(entry=>entry.id===candidate?.id)||null;}
export function googleMapsUrl(candidate,entry){
 const url=new URL('https://www.google.com/maps/search/');url.searchParams.set('api','1');
 let query=[candidate?.name,candidate?.city].filter(value=>typeof value==='string'&&value.trim()).join(' ').slice(0,300)||'Estabelecimento';
 const id=placeId(entry?.placeId);if(id)url.searchParams.set('query_place_id',id);
 url.searchParams.set('query',query);
 while(url.href.length>2048&&query.length>1){query=query.slice(0,-1);url.searchParams.set('query',query);}
 return url.href;
}
