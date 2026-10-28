import test from 'node:test';
import assert from 'node:assert/strict';
import {createLeadStore} from '../dist/lead-store.mjs';
import {normalizeElement,validateBackup,canProspect,digitalPresence} from '../dist/domain.mjs';

const KEY='orion-prospecta-v1';
const city={name:'Cidade',uf:'SC',lat:-26.48,lon:-49.07,ddd:47};
const stamp='2026-10-28T12:00:00.000Z';
const lead=(id=1,changes={})=>({...normalizeElement({type:'node',id,lat:-26.48+id*.001,lon:-49.07,tags:{name:'Empresa '+id}},city),stage:'Revisar',verified:'unknown',reviewedAt:'',reviewUrl:'',ignored:false,ignoredAt:'',notes:'',followup:'',...changes});
function storage(initial=[]){
 let raw=JSON.stringify({version:1,leads:initial}),readError=false,writeError=false,writes=0;
 return {
  getItem(key){assert.equal(key,KEY);if(readError)throw new Error('read blocked');return raw;},
  setItem(key,value){assert.equal(key,KEY);if(writeError)throw new Error('quota full');raw=value;writes++;},
  raw:()=>raw,
  writeRaw:value=>{raw=value;},
  readError:value=>{readError=value;},
  writeError:value=>{writeError=value;},
  writes:()=>writes,
  records:()=>JSON.parse(raw).leads
 };
}
const store=database=>createLeadStore({storage:database});

test('saved personal data round-trips through a fresh store without qualifying unknown candidates',()=>{
 const database=storage(),first=store(database);
 assert.deepEqual(first.load().leads,[]);
 assert.equal(first.save([lead(1,{notes:'Revisar antes de abordar',ignored:true,ignoredAt:stamp})]).ok,true);
 const reloaded=store(database).load();
 assert.equal(reloaded.ok,true);assert.equal(reloaded.leads[0].notes,'Revisar antes de abordar');assert.equal(reloaded.leads[0].ignoredAt,stamp);
 assert.equal(canProspect(reloaded.leads[0]),false);assert.equal(digitalPresence(reloaded.leads[0]).status,'unknown');
});

test('corrupt or unreadable stored data cannot be replaced with a partial or empty list',()=>{
 for(const raw of ['{broken',JSON.stringify({version:1,leads:[lead(),{...lead(2),lat:999}]}),JSON.stringify({version:99,leads:[lead()]})]){
  const database=storage();database.writeRaw(raw);const instance=store(database);
  assert.equal(instance.load().ok,false);assert.equal(instance.save([]).ok,false);assert.equal(instance.save([lead(3)]).ok,false);
  assert.equal(database.raw(),raw);assert.equal(database.writes(),0);
 }
 const database=storage([lead(1,{notes:'Preservar'})]),instance=store(database);database.readError(true);
 assert.equal(instance.load().ok,false);assert.equal(instance.save([lead(2)]).ok,false);database.readError(false);
 assert.equal(database.records()[0].notes,'Preservar');assert.equal(database.writes(),0);
});

test('read failure after a valid load and quota failure preserve the stored list and pending baseline',()=>{
 const database=storage([lead(1,{notes:'Original'})]),instance=store(database),local=instance.load().leads;local[0].notes='Edição pendente';
 database.readError(true);assert.equal(instance.save(local).ok,false);database.readError(false);assert.equal(database.records()[0].notes,'Original');
 database.writeError(true);assert.equal(instance.save(local).ok,false);assert.equal(database.records()[0].notes,'Original');
 database.writeError(false);assert.equal(instance.save(local).ok,true);assert.equal(database.records()[0].notes,'Edição pendente');
});

test('two stale tabs preserve independent new records and edits to different records',()=>{
 const database=storage([lead(1),lead(2)]),first=store(database),second=store(database),a=first.load().leads,b=second.load().leads;
 b[1].notes='Anotação na segunda aba';b.push(lead(3,{ignored:true,ignoredAt:stamp}));assert.equal(second.save(b).ok,true);
 a[0].stage='Selecionado';a.push(lead(4));assert.equal(first.save(a).ok,true);
 const records=database.records();assert.equal(records.length,4);assert.equal(records.find(item=>item.id==='osm:node:2').notes,'Anotação na segunda aba');
 assert.equal(records.find(item=>item.id==='osm:node:3').ignored,true);assert.equal(records.find(item=>item.id==='osm:node:1').stage,'Selecionado');
});

test('field deltas preserve a remote ignore while another tab edits notes and allow explicit undo',()=>{
 const database=storage([lead()]),first=store(database),second=store(database),a=first.load().leads,b=second.load().leads;
 b[0].ignored=true;b[0].ignoredAt=stamp;assert.equal(second.save(b).ok,true);
 a[0].notes='Nota local';assert.equal(first.save(a).ok,true);
 assert.equal(database.records()[0].ignored,true);assert.equal(database.records()[0].notes,'Nota local');
 const local=first.load().leads;local[0].ignored=false;local[0].ignoredAt='';assert.equal(first.save(local).ok,true);
 assert.equal(database.records()[0].ignored,false);assert.equal(database.records()[0].ignoredAt,'');assert.equal(database.records()[0].notes,'Nota local');
});

test('remote review dates and local notes survive while explicit same-field edits win',()=>{
 const database=storage([lead()]),first=store(database),second=store(database),a=first.load().leads,b=second.load().leads;
 b[0].verified='missing';b[0].reviewedAt=stamp;b[0].notes='Nota remota';assert.equal(second.save(b).ok,true);
 a[0].notes='Última edição explícita';assert.equal(first.save(a).ok,true);
 const record=database.records()[0];assert.equal(record.notes,'Última edição explícita');assert.equal(record.reviewedAt,stamp);assert.equal(record.verified,'missing');
});

test('unchanged stale records never resurrect remote removals and explicit deletion removes only its ID',()=>{
 const database=storage([lead(1),lead(2),lead(3)]),first=store(database),second=store(database),a=first.load().leads,b=second.load().leads;
 assert.equal(second.save(b.filter(item=>item.id!=='osm:node:2')).ok,true);
 a[0].notes='Alterar apenas 1';assert.equal(first.save(a).ok,true);assert.equal(database.records().some(item=>item.id==='osm:node:2'),false);
 const local=first.load().leads;const other=store(database),remote=other.load().leads;remote.push(lead(4));assert.equal(other.save(remote).ok,true);
 assert.equal(first.save(local.filter(item=>item.id!=='osm:node:3')).ok,true);assert.deepEqual(database.records().map(item=>item.id).sort(),['osm:node:1','osm:node:4']);
});

test('editing a remotely deleted record reports a conflict instead of silently restoring it',()=>{
 const database=storage([lead()]),first=store(database),second=store(database),a=first.load().leads;second.load();assert.equal(second.save([]).ok,true);
 const raw=database.raw();a[0].notes='Não perder silenciosamente';assert.equal(first.save(a).ok,false);assert.equal(database.raw(),raw);
});

test('new equivalent records preserve remote notes and stage, union evidence and keep explicit ignore',()=>{
 const database=storage(),first=store(database),second=store(database);first.load();second.load();
 const remote=lead(1,{notes:'Nota remota',stage:'Conversando',website:'https://empresa.example/'});assert.equal(second.save([remote]).ok,true);
 const incoming=lead(2,{name:remote.name,lat:remote.lat,lon:remote.lon,notes:'Outra nota',stage:'Revisar',ignored:true,ignoredAt:stamp,presenceLinks:[{kind:'menu',url:'https://menu.example/'}]});
 assert.equal(first.save([incoming]).ok,true);const records=database.records();assert.equal(records.length,1);assert.equal(records[0].id,remote.id);assert.equal(records[0].notes,'Nota remota');assert.equal(records[0].stage,'Conversando');
 assert.equal(records[0].ignored,true);assert.equal(digitalPresence(records[0]).status,'exists');assert.equal(records[0].presenceLinks.length,2);
});

test('returned arrays cannot mutate the stored baseline and unknown fields never persist',()=>{
 const database=storage([lead()]),instance=store(database),loaded=instance.load().leads;loaded[0].notes='Edição';loaded[0].googleResult={websiteUri:'https://google-only.example/'};
 assert.equal(instance.save(loaded).ok,true);assert.equal(database.records()[0].notes,'Edição');assert.equal(database.records()[0].googleResult,undefined);
 const reloaded=instance.load().leads;reloaded[0].notes='Outra edição';assert.equal(instance.save(reloaded).ok,true);assert.equal(database.records()[0].notes,'Outra edição');
 assert.deepEqual(validateBackup({version:1,leads:database.records()}),database.records());
});

test('duplicate IDs, invalid records and oversized lists cannot overwrite saved data',()=>{
 const database=storage([lead()]),instance=store(database);instance.load();const raw=database.raw();
 for(const invalid of [[lead(),lead()], [{...lead(),lat:999}],Array.from({length:5001},(_,index)=>lead(index+1))])assert.equal(instance.save(invalid).ok,false);
 assert.equal(database.raw(),raw);assert.equal(database.writes(),0);
});

test('merging an explicit website review preserves its scope instead of treating it as an old social exclusion',()=>{
 const social=[{kind:'social',url:'https://facebook.com/empresa'}],database=storage([lead(1,{notes:'Nota anterior',presenceLinks:social})]),instance=store(database);instance.load();
 const incoming=lead(2,{name:'Empresa 1',lat:lead(1).lat,lon:lead(1).lon,presenceLinks:social,verified:'exists',reviewScope:'website',reviewedAt:stamp});
 assert.equal(instance.save([...instance.load().leads,incoming]).ok,true);
 const record=store(database).load().leads[0];assert.equal(record.verified,'exists');assert.equal(record.reviewScope,'website');assert.equal(record.notes,'Nota anterior');assert.equal(digitalPresence(record).status,'exists');
});
