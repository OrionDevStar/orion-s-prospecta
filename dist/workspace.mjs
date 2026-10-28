import {NICHES,STAGES,validateBackup} from './domain.mjs';
import {normalizeSearchCenter,normalizeSearchArea} from './search-area.mjs';

export const WORKSPACE_KEY='prospecta-workspace-v1';
export const WORKSPACE_TAB_KEY='prospecta-workspace-tab-v1';
const MAX_RESULTS=600;
const OSM_FIELDS=['id','name','lat','lon','city','category','address','website','instagram','presenceLinks','phone','phoneNumber','whatsapp','whatsappConfirmed','sourceUrl','fetchedAt','distance'];
const views=new Set(['discover','review','saved']),sorts=new Set(['distance','contact','name']),presences=new Set(['qualified','all','ignored']);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const coordinate=(value,limit)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit;
const ddd=value=>Number.isInteger(Number(value))&&Number(value)>=10&&Number(value)<=99?Number(value):null;
const validTabId=value=>typeof value==='string'&&/^[a-z\d][a-z\d_-]{7,79}$/i.test(value)?value:'';
const tabIds=new WeakMap();
let fallbackTabId='';
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return '';
 const stamp=Date.parse(value),[year,month,day]=value.slice(0,10).split('-').map(Number);
 if(!Number.isFinite(stamp)||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return '';
 return new Date(stamp).toISOString();
}
function cityData(raw){
 if(!record(raw)||!Number.isSafeInteger(Number(raw.id))||Number(raw.id)<=0||!text(raw.name,150).trim()||!/^[A-Z]{2}$/i.test(raw.uf)||!coordinate(raw.lat,90)||!coordinate(raw.lon,180))return null;
 return {id:Number(raw.id),name:text(raw.name,150),uf:raw.uf.toUpperCase(),ddd:ddd(raw.ddd),lat:raw.lat,lon:raw.lon};
}
function sourceResults(raw){
 if(!Array.isArray(raw))return [];
 const seen=new Set(),results=[];
 for(const item of raw.slice(0,MAX_RESULTS)){
  if(!record(item)||typeof item.name!=='string'||!item.name.trim())continue;
  try{
   // Strip review, CRM and Google fields before using the existing record validator.
   const source=Object.fromEntries(OSM_FIELDS.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]));
   const validated=validateBackup({version:1,leads:[source]})[0];
   if(seen.has(validated.id))continue;
   seen.add(validated.id);
   results.push({...Object.fromEntries(OSM_FIELDS.map(key=>[key,validated[key]])),ddd:ddd(item.ddd)});
  }catch{/* One damaged record must not erase the rest of the search. */}
 }
 return results;
}

/** A durable search contains OSM source records and UI state, never Google replies or CRM decisions. */
export function normalizeWorkspace(raw){
 try{
  if(!record(raw)||raw.version!==1)return null;
  const results=sourceResults(raw.results),city=cityData(raw.city),search=record(raw.search)?raw.search:{},filters=record(raw.filters)?raw.filters:{},map=record(raw.mapView)?raw.mapView:null;
  const niche=Object.hasOwn(NICHES,search.niche)?search.niche:'all',radius=[3,5,10,20].includes(search.radius)?search.radius:5,searched=raw.searched===true||results.length>0,legacyCenter=city?{lat:city.lat,lon:city.lon,label:city.name+' · '+city.uf,mode:'city'}:null;
  const searchCenter=normalizeSearchCenter(raw.searchCenter)||normalizeSearchCenter(legacyCenter),searchedArea=normalizeSearchArea(raw.searchedArea)||(searched&&legacyCenter&&!Object.hasOwn(raw,'searchedArea')?normalizeSearchArea({...legacyCenter,niche,radius}):null);
  return {version:1,tabId:validTabId(raw.tabId),results,city,searchCenter,searchedArea,search:{cityInput:text(search.cityInput,180),niche,radius},view:views.has(raw.view)?raw.view:'discover',filters:{name:text(filters.name,300),contactOnly:filters.contactOnly===true,stage:STAGES.includes(filters.stage)?filters.stage:'',sort:sorts.has(filters.sort)?filters.sort:'distance',presence:presences.has(filters.presence)?filters.presence:'qualified'},selectedId:typeof raw.selectedId==='string'&&/^osm:(node|way|relation):\d+$/.test(raw.selectedId)?raw.selectedId:'',listScrollTop:typeof raw.listScrollTop==='number'&&Number.isFinite(raw.listScrollTop)?Math.max(0,Math.min(10000000,raw.listScrollTop)):0,mapView:map&&coordinate(map.lat,90)&&coordinate(map.lon,180)&&typeof map.zoom==='number'&&Number.isFinite(map.zoom)&&map.zoom>=1&&map.zoom<=20?{lat:map.lat,lon:map.lon,zoom:map.zoom}:null,searched,searchedAt:timestamp(raw.searchedAt),updatedAt:timestamp(raw.updatedAt)};
 }catch{return null;}
}

function stores(options){
 const answer={};
 for(const [key,globalName] of [['local','localStorage'],['session','sessionStorage']]){
  if(Object.hasOwn(options,key)){answer[key]=options[key];continue;}
  try{answer[key]=globalThis[globalName];}catch{answer[key]=null;}
 }
 return answer;
}
function read(storage,label,errors){
 if(!storage||typeof storage.getItem!=='function'){errors.push(label+'_unavailable');return null;}
 let raw;
 try{raw=storage.getItem(WORKSPACE_KEY);}catch{errors.push(label+'_read_failed');return null;}
 if(raw===null||raw===undefined||raw==='')return null;
 try{const parsed=normalizeWorkspace(JSON.parse(raw));if(!parsed)throw new Error();return parsed;}
 catch{errors.push(label+'_invalid');return null;}
}
function currentTab(storage,session,errors,create=false){
 let marker='';
 if(storage&&typeof storage.getItem==='function'){
  try{marker=validTabId(storage.getItem(WORKSPACE_TAB_KEY));}
  catch{errors.push('session_tab_read_failed');}
 }
 const object=storage&&(typeof storage==='object'||typeof storage==='function');
 let id=marker||validTabId(session?.tabId)||(object?tabIds.get(storage):fallbackTabId)||'';
 if(!create)return id;
 if(!id){
  try{id=globalThis.crypto?.randomUUID?.()||'';}catch{}
  if(!validTabId(id))id='tab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 }
 if(object)tabIds.set(storage,id);else fallbackTabId=id;
 if(!marker&&storage&&typeof storage.setItem==='function'){
  try{storage.setItem(WORKSPACE_TAB_KEY,id);}
  catch{errors.push('session_tab_write_failed');}
 }
 return id;
}
function newest(local,session,tabId){
 if(!session)return local?{workspace:local,source:'local'}:{workspace:null,source:null};
 if(!local)return {workspace:session,source:'session'};
 const newer=(Date.parse(local.updatedAt)||0)>(Date.parse(session.updatedAt)||0);
 // Another tab's newer search must not replace the work this tab left while visiting Google.
 // A newer local copy can repair this tab's failed session write only when its writer matches.
 const sameTab=!!tabId&&local.tabId===tabId;
 const legacy=!local.tabId&&!session.tabId;
 return newer&&(sameTab||legacy)?{workspace:local,source:'local'}:{workspace:session,source:'session'};
}
export function loadWorkspace(options={}){
 const errors=[],storage=stores(options),local=read(storage.local,'local',errors),session=read(storage.session,'session',errors);
 return {...newest(local,session,currentTab(storage.session,session,errors)),errors};
}
export function saveWorkspace(snapshot,options={}){
 const workspace=normalizeWorkspace(snapshot),errors=[];
 if(!workspace)return {ok:false,persistent:false,session:false,errors:['invalid_workspace']};
 const storage=stores(options),previousLocal=read(storage.local,'local',errors),previousSession=read(storage.session,'session',errors);
 // The caller may have just restored another tab's global snapshot. Its writer is never inherited.
 workspace.tabId=currentTab(storage.session,previousSession,errors,true);
 let current;
 try{current=typeof options.now==='function'?options.now():new Date();current=current instanceof Date?current.getTime():Number(current);if(!Number.isFinite(current))throw new Error();}
 catch{return {ok:false,persistent:false,session:false,errors:[...errors,'invalid_time']};}
 const last=Math.max(Date.parse(previousLocal?.updatedAt)||0,Date.parse(previousSession?.updatedAt)||0);
 workspace.updatedAt=new Date(Math.max(current,last+1)).toISOString();
 const serialized=JSON.stringify(workspace),saved={local:false,session:false};
 for(const label of ['local','session']){
  if(!storage[label]||typeof storage[label].setItem!=='function')continue;
  try{storage[label].setItem(WORKSPACE_KEY,serialized);saved[label]=true;}
  catch{errors.push(label+'_write_failed');}
 }
 return {ok:saved.local||saved.session,persistent:saved.local,session:saved.session,errors};
}
