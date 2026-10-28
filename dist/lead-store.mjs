import {validateBackup,sameBusiness,mergePresenceLinks,digitalPresence} from './domain.mjs';

const DEFAULT_KEY='orion-prospecta-v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const equal=(first,second)=>JSON.stringify(first)===JSON.stringify(second);

function normalize(leads){
 const records=validateBackup({version:1,leads});
 const ids=new Set();
 for(const record of records){
  if(ids.has(record.id))throw new Error('duplicate_id');
  ids.add(record.id);
 }
 return records;
}

function mergeNewRecord(remote,incoming){
 const exists=digitalPresence(remote).status==='exists'||digitalPresence(incoming).status==='exists';
 const solutionReview=digitalPresence(remote).status==='exists'?remote:incoming;
 const review=remote.verified==='missing'&&remote.reviewedAt?remote:incoming;
 const ignored=remote.ignored===true||incoming.ignored===true;
 return {
  ...incoming,...remote,
  website:remote.website||incoming.website,
  instagram:remote.instagram||incoming.instagram,
  presenceLinks:mergePresenceLinks(digitalPresence(remote).urls,digitalPresence(incoming).urls),
  verified:exists?'exists':review.verified,
  reviewScope:exists?solutionReview.reviewScope:review.reviewScope,
  reviewedAt:exists?(remote.reviewedAt||incoming.reviewedAt):review.reviewedAt,
  reviewUrl:remote.reviewUrl||incoming.reviewUrl,
  ignored,
  ignoredAt:ignored?(remote.ignoredAt||incoming.ignoredAt):'',
  notes:remote.notes||incoming.notes,
  stage:remote.stage,
  followup:remote.followup||incoming.followup
 };
}

/** Keeps personal edits separate from stale snapshots held by other tabs. */
export function createLeadStore({storage,key=DEFAULT_KEY}={}){
 let baseline=[];

 function read(){
  try{
   const raw=storage.getItem(key);
   const data=raw===null?{version:1,leads:[]}:JSON.parse(raw);
   return {ok:true,leads:normalize(validateBackup(data))};
  }catch{
   return {ok:false,leads:copy(baseline),error:'Não foi possível ler a lista salva. Os dados existentes foram preservados; nenhuma gravação será feita até a leitura ser válida.'};
  }
 }

 function load(){
  const result=read();
  if(result.ok)baseline=copy(result.leads);
  return result;
 }

 function save(leads){
  let local;
  try{local=normalize(leads);}
  catch{return {ok:false,leads:copy(baseline),error:'A lista contém registros inválidos ou excede o limite de 5.000. Os dados salvos foram preservados.'};}

  // Re-read immediately before computing the write. Never replace unreadable data.
  const latest=read();
  if(!latest.ok)return latest;
  const baseById=new Map(baseline.map(record=>[record.id,record]));
  const localById=new Map(local.map(record=>[record.id,record]));
  const removed=new Set(baseline.filter(record=>!localById.has(record.id)).map(record=>record.id));
  let merged=latest.leads.filter(record=>!removed.has(record.id));

  for(const record of local){
   const previous=baseById.get(record.id);
   if(!previous){
    const index=merged.findIndex(remote=>sameBusiness(remote,record));
    if(index<0)merged.push(record);
    else merged[index]=mergeNewRecord(merged[index],record);
    continue;
   }

   const changed=Object.keys(record).filter(field=>field!=='id'&&field!=='sourceUrl'&&!equal(record[field],previous[field]));
   if(!changed.length)continue;
   const index=merged.findIndex(remote=>sameBusiness(remote,record));
   if(index<0){
    return {ok:false,leads:copy(latest.leads),error:'Um registro que você está editando foi removido em outra aba. A lista salva foi preservada. Reabra a revisão antes de salvar novamente.'};
   }
   const updated={...merged[index]};
   for(const field of changed){
    updated[field]=field==='presenceLinks'?mergePresenceLinks(updated.presenceLinks,record.presenceLinks):record[field];
   }
   merged[index]=updated;
  }

  try{merged=normalize(merged);}
  catch{return {ok:false,leads:copy(latest.leads),error:'Não foi possível combinar as alterações com a lista salva. Os dados existentes foram preservados.'};}
  try{
   if(!equal(merged,latest.leads))storage.setItem(key,JSON.stringify({version:1,leads:merged}));
  }catch{
   return {ok:false,leads:copy(latest.leads),error:'Não foi possível gravar a lista no navegador. Os dados anteriores foram preservados; mantenha esta página aberta para guardar suas alterações.'};
  }
  baseline=copy(merged);
  return {ok:true,leads:copy(merged)};
 }

 return {load,save};
}
