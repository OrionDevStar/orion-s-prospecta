import { mkdir, open, readFile, rename, unlink, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { distanceKm, fold, phoneDigits, safeUrl, classifyWebsite } from '../dist/domain.mjs';

export const PLACES_ENDPOINT='https://places.googleapis.com/v1/places:searchText';
export const PLACES_FIELD_MASK='places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus,places.attributions';
export const PLACES_SKU='Places API Text Search Enterprise';
export const PLACES_LIMITS=Object.freeze({monthly:900,daily:25,rolling:900,rollingDays:32});
const PRICING_REVIEWED_AT='2026-10-27',ZONE='America/Los_Angeles',DAY_MS=86400000;
const dates=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});

export class PlacesError extends Error {
 constructor(code,message,httpStatus=503){super(message);this.name='PlacesError';this.code=code;this.httpStatus=httpStatus;}
}
const failStorage=()=>new PlacesError('usage_unavailable','A consulta foi bloqueada porque o controle de consumo não pôde ser confirmado. Preserve os arquivos de uso e confira as permissões.');
function dateKeys(date){const parts=Object.fromEntries(dates.formatToParts(date).map(part=>[part.type,part.value]));return {day:parts.year+'-'+parts.month+'-'+parts.day,month:parts.year+'-'+parts.month};}
function instant(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw failStorage();return date;}
function nextBoundary(date,period){const key=dateKeys(date)[period];let low=date.getTime(),high=low+(period==='day'?28*3600000:33*DAY_MS);while(high-low>1000){const middle=Math.floor((low+high)/2);if(dateKeys(new Date(middle))[period]===key)low=middle;else high=middle;}return new Date(Math.ceil(high/1000)*1000).toISOString();}
function boundedLimit(value,maximum){if(value===undefined)return maximum;if(!Number.isInteger(value)||value<0||value>maximum)throw new TypeError('O limite Places deve ser um inteiro entre zero e '+maximum+'.');return value;}
function cleanText(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function candidateData(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new PlacesError('invalid_candidate','Negócio inválido para consulta.',400);
 const name=cleanText(value.name,300),city=cleanText(value.city,150),lat=value.lat,lon=value.lon;
 if(name.length<2||city.length<2||typeof lat!=='number'||!Number.isFinite(lat)||Math.abs(lat)>90||typeof lon!=='number'||!Number.isFinite(lon)||Math.abs(lon)>180)throw new PlacesError('invalid_candidate','Informe nome, cidade e coordenadas válidas do negócio.',400);
 const address=cleanText(value.address,500),phone=phoneDigits(value.phoneNumber||value.phone||'');
 return {name,city,lat,lon,address:/^Endereço não informado/i.test(address)?'':address,phone};
}
function normalizedName(value){return fold(value).replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function nameSimilarity(first,second){const a=normalizedName(first),b=normalizedName(second);if(a===b)return 1;const left=new Set(a.split(' ')),right=new Set(b.split(' ')),shared=[...left].filter(token=>right.has(token)).length;return shared/Math.max(left.size,right.size);}
function comparableAddress(first,second){const a=normalizedName(first),b=normalizedName(second),numberA=a.match(/\b\d+[a-z]?\b/)?.[0],numberB=b.match(/\b\d+[a-z]?\b/)?.[0];if(!numberA||numberA!==numberB)return false;const ignored=new Set(['rua','r','avenida','av','travessa','tv','rodovia','rod','de','do','da','dos','das']);const left=a.split(' ').filter(token=>token.length>2&&!ignored.has(token)),right=new Set(b.split(' '));return left.filter(token=>right.has(token)).length>=Math.min(2,left.length)&&left.length>0;}
function publicPlace(raw){
 if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!raw.id||raw.id.length>300)return null;
 const latitude=raw.location?.latitude,longitude=raw.location?.longitude;
 if(typeof latitude!=='number'||!Number.isFinite(latitude)||Math.abs(latitude)>90||typeof longitude!=='number'||!Number.isFinite(longitude)||Math.abs(longitude)>180)return null;
 return {id:raw.id,displayName:cleanText(raw.displayName?.text,300),formattedAddress:cleanText(raw.formattedAddress,700),websiteUri:safeUrl(raw.websiteUri),googleMapsUri:safeUrl(raw.googleMapsUri),businessStatus:cleanText(raw.businessStatus,40),attributions:Array.isArray(raw.attributions)?raw.attributions.slice(0,20).map(item=>({provider:cleanText(item?.provider,200),providerUri:safeUrl(item?.providerUri)})):[],location:{latitude,longitude},phoneNumber:phoneDigits(raw.nationalPhoneNumber||'')};
}
function matchingResult(candidate,rawPlaces){
 const places=rawPlaces.slice(0,3).map(publicPlace).filter(Boolean);
 if(!places.length)return {status:rawPlaces.length?'ambiguous':'not_found',alternatives:[]};
 const ranked=places.map(place=>{const similarity=nameSimilarity(candidate.name,place.displayName),distance=distanceKm(candidate.lat,candidate.lon,place.location.latitude,place.location.longitude),phoneSame=!!candidate.phone&&candidate.phone===place.phoneNumber,phoneConflict=!!candidate.phone&&!!place.phoneNumber&&!phoneSame,addressSame=comparableAddress(candidate.address,place.formattedAddress);return {place,similarity,distance,phoneSame,phoneConflict,addressSame};});
 const plausible=ranked.filter(match=>match.distance<=.5&&(match.similarity>=.8||match.phoneSame));
 const confident=plausible.filter(match=>!match.phoneConflict&&((match.similarity===1&&match.distance<=.15)||(match.similarity>=.6&&match.distance<=.15&&(match.phoneSame||match.addressSame))));
 if(confident.length!==1||plausible.length!==1)return {status:'ambiguous',alternatives:places};
 const place=confident[0].place;
 if(place.businessStatus==='CLOSED_PERMANENTLY')return {status:'closed_permanently',place};
 if(place.businessStatus==='CLOSED_TEMPORARILY')return {status:'closed_temporarily',place};
 return {status:{solution:'found_website',social:'social_only',links:'links_only',none:'no_website_listed'}[classifyWebsite(place.websiteUri)],place};
}

/** One request per verification. Quotas are reserved before the request and never refunded. */
export function createPlacesService({apiKey='',usageFile,fetchImpl=globalThis.fetch,now=()=>new Date(),monthlyLimit,dailyLimit}={}){
 if(typeof usageFile!=='string'||!usageFile)throw new TypeError('usageFile é obrigatório.');
 const file=resolve(usageFile),marker=file+'.initialized',lock=file+'.lock',key=String(apiKey||'').trim(),monthly=boundedLimit(monthlyLimit,PLACES_LIMITS.monthly),daily=boundedLimit(dailyLimit,PLACES_LIMITS.daily);
 let queue=Promise.resolve(),pending=0;
 function emptyLedger(){return {version:1,events:[],lastAttemptAt:null};}
 async function readLedger(){
  let content;
  try{content=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw failStorage();try{await access(marker);throw failStorage();}catch(markerError){if(markerError.code==='ENOENT')return emptyLedger();throw failStorage();}}
  try{
   await access(marker);if(content.length>1500000)throw failStorage();const state=JSON.parse(content);
   if(state.version!==1||!Array.isArray(state.events)||state.events.length>20000||!(state.lastAttemptAt===null||typeof state.lastAttemptAt==='string'))throw failStorage();
   let previous=-Infinity;
   for(const stamp of state.events){const parsed=Date.parse(stamp);if(typeof stamp!=='string'||!Number.isFinite(parsed)||new Date(parsed).toISOString()!==stamp||parsed<previous)throw failStorage();previous=parsed;}
   if(state.events.length&&state.lastAttemptAt!==state.events.at(-1))throw failStorage();if(!state.events.length&&state.lastAttemptAt!==null)throw failStorage();
   return {version:1,events:state.events,lastAttemptAt:state.lastAttemptAt};
  }catch{throw failStorage();}
 }
 function usage(state,date){
  const keys=dateKeys(date),events=state.events.map(stamp=>({stamp,date:new Date(stamp),keys:dateKeys(new Date(stamp))})),monthlyUsed=events.filter(event=>event.keys.month===keys.month).length,dailyUsed=events.filter(event=>event.keys.day===keys.day).length,rollingEvents=events.filter(event=>date-event.date<PLACES_LIMITS.rollingDays*DAY_MS),rollingUsed=rollingEvents.length,monthReset=nextBoundary(date,'month'),dayReset=nextBoundary(date,'day'),rollingReset=rollingEvents.length?new Date(rollingEvents[0].date.getTime()+PLACES_LIMITS.rollingDays*DAY_MS).toISOString():dayReset;
  const clockBack=state.lastAttemptAt&&date.getTime()<Date.parse(state.lastAttemptAt),blocks=[];
  if(!key)blocks.push({reason:'not_configured',reset:dayReset});if(clockBack)blocks.push({reason:'clock_changed',reset:state.lastAttemptAt});if(monthlyUsed>=monthly)blocks.push({reason:'monthly_limit',reset:monthReset});if(dailyUsed>=daily)blocks.push({reason:'daily_limit',reset:dayReset});if(rollingUsed>=monthly)blocks.push({reason:'rolling_limit',reset:rollingReset});
  return {enabled:!!key,monthly:{used:monthlyUsed,limit:monthly,remaining:Math.max(0,monthly-monthlyUsed),resetAt:monthReset},daily:{used:dailyUsed,limit:daily,remaining:Math.max(0,daily-dailyUsed),resetAt:dayReset},rolling:{used:rollingUsed,limit:monthly,remaining:Math.max(0,monthly-rollingUsed),days:PLACES_LIMITS.rollingDays,resetAt:rollingReset},blocked:blocks.length>0,blockReason:blocks[0]?.reason||null,nextResetAt:blocks.length?blocks.map(block=>block.reset).sort().at(-1):dayReset,timezone:ZONE,sku:PLACES_SKU,pricingReviewedAt:PRICING_REVIEWED_AT,scope:'Este contador cobre somente esta instalação do Prospecta.'};
 }
 async function status(){return usage(await readLedger(),instant(now()));}
 async function reserve(){
  let handle,temp;
  try{
   await mkdir(dirname(file),{recursive:true,mode:0o700});
   try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new PlacesError('usage_locked','Outra instância está atualizando o consumo. Aguarde e tente novamente.',503);throw failStorage();}
   const date=instant(now()),state=await readLedger(),current=usage(state,date);
   if(current.blocked){if(current.blockReason==='not_configured')throw new PlacesError('not_configured','Configure PLACESAPI no .env do servidor para habilitar a consulta.',503);if(current.blockReason==='clock_changed')throw new PlacesError('clock_changed','O relógio retrocedeu. A consulta ficou bloqueada para preservar os limites.',503);throw new PlacesError(current.blockReason,'Limite gratuito de consultas atingido. Aguarde a renovação indicada no contador.',429);}
   if(!state.events.length){try{const initial=await open(marker,'wx',0o600);await initial.writeFile('Prospecta Places usage v1\n');await initial.sync();await initial.close();}catch(error){if(error.code!=='EEXIST')throw failStorage();}}
   const stamp=date.toISOString(),cutoff=date.getTime()-400*DAY_MS;state.events=state.events.filter(event=>Date.parse(event)>=cutoff);state.events.push(stamp);state.lastAttemptAt=stamp;
   temp=file+'.tmp-'+process.pid+'-'+randomUUID();const out=await open(temp,'wx',0o600);try{await out.writeFile(JSON.stringify(state));await out.sync();}finally{await out.close();}await rename(temp,file);temp=null;
   return usage(state,date);
  }catch(error){if(error instanceof PlacesError)throw error;throw failStorage();}
  finally{if(temp)await unlink(temp).catch(()=>{});if(handle){await handle.close().catch(()=>{});await unlink(lock).catch(()=>{});}}
 }
 async function run(candidate){
  const charged=await reserve();let response,data;
  try{
   response=await fetchImpl(PLACES_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':PLACES_FIELD_MASK},body:JSON.stringify({textQuery:[candidate.name,candidate.address,candidate.city].filter(Boolean).join(', '),languageCode:'pt-BR',regionCode:'BR',pageSize:3,locationBias:{circle:{center:{latitude:candidate.lat,longitude:candidate.lon},radius:500}}}),redirect:'error',signal:AbortSignal.timeout(12000)});
  }catch(error){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw new PlacesError('google_timeout','O Google demorou para responder. A tentativa já foi contabilizada; não repetimos automaticamente.',504);throw new PlacesError('google_unavailable','Não foi possível consultar o Google. A tentativa já foi contabilizada.',502);}
  if(!response?.ok){if(response?.status===401||response?.status===403)throw new PlacesError('google_denied','O Google recusou a consulta. Confira a ativação de Places API (New), o faturamento e as restrições da chave.',503);if(response?.status===429)throw new PlacesError('google_quota','O Google informou limite de uso. A tentativa foi contabilizada e não será repetida automaticamente.',429);throw new PlacesError('google_unavailable','O Google não concluiu a consulta. A tentativa foi contabilizada.',502);}
  try{const content=await response.text();if(content.length>256000)throw new Error();data=JSON.parse(content);if(!data||typeof data!=='object'||(data.places!==undefined&&!Array.isArray(data.places)))throw new Error();}catch{throw new PlacesError('google_invalid_response','O Google retornou uma resposta inesperada. A tentativa foi contabilizada.',502);}
  return {...matchingResult(candidate,data.places||[]),checkedAt:instant(now()).toISOString(),usage:charged};
 }
 function verify(value){
  let candidate;try{candidate=candidateData(value);}catch(error){return Promise.reject(error);}
  if(pending>=5)return Promise.reject(new PlacesError('busy','Há consultas em andamento. Aguarde antes de iniciar outras.',429));
  pending++;const result=queue.then(()=>run(candidate));queue=result.then(()=>{},()=>{});return result.finally(()=>pending--);
 }
 return {status,verify};
}
