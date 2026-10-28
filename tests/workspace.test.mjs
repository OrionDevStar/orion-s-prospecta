import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeElement,canProspect,digitalPresence} from '../dist/domain.mjs';
import {WORKSPACE_KEY,WORKSPACE_TAB_KEY,normalizeWorkspace,loadWorkspace,saveWorkspace} from '../dist/workspace.mjs';

const city={id:4208906,name:'Jaraguá do Sul',uf:'SC',ddd:47,lat:-26.4851,lon:-49.0713};
const lead=(id=1)=>normalizeElement({type:'node',id,lat:city.lat+id*.0001,lon:city.lon,tags:{name:'Negócio sintético '+id,amenity:'restaurant',phone:'(47) 3000-0000'}},city);
const snapshot=(changes={})=>({version:1,results:[lead(1),lead(2)],city,search:{cityInput:'Jaraguá do Sul · SC',niche:'food',radius:3},view:'review',filters:{name:'sintético',contactOnly:true,stage:'Revisar',sort:'name',presence:'all'},selectedId:'osm:node:2',listScrollTop:172,mapView:{lat:city.lat,lon:city.lon,zoom:14},searched:true,searchedAt:'2026-10-27T12:00:00.000Z',updatedAt:'2026-10-27T12:01:00.000Z',...changes});
class Storage{
 constructor(){this.values=new Map();this.failRead=false;this.failWrite=false;}
 getItem(key){if(this.failRead)throw new Error('read denied');return this.values.get(key)??null;}
 setItem(key,value){if(this.failWrite)throw new Error('quota full');this.values.set(key,String(value));}
}

test('search and UI survive navigation and a new tab without another source query',()=>{
 const local=new Storage(),session=new Storage(),input=snapshot(),saved=saveWorkspace(input,{local,session,now:()=>new Date('2026-10-27T12:02:00Z')});
 assert.equal(saved.ok,true);assert.equal(saved.persistent,true);assert.equal(saved.session,true);
 const resumed=loadWorkspace({local,session});assert.equal(resumed.source,'session');assert.equal(resumed.workspace.results.length,2);assert.deepEqual(resumed.workspace.search,input.search);assert.deepEqual(resumed.workspace.filters,input.filters);assert.deepEqual(resumed.workspace.city,city);assert.deepEqual(resumed.workspace.mapView,input.mapView);assert.equal(resumed.workspace.view,'review');assert.equal(resumed.workspace.selectedId,input.selectedId);assert.equal(resumed.workspace.listScrollTop,172);
 const newTab=loadWorkspace({local,session:new Storage()});assert.equal(newTab.source,'local');assert.equal(newTab.workspace.results[1].name,input.results[1].name);assert.equal(canProspect(newTab.workspace.results[1]),false);
});

test('workspace has no time expiry and ignores unrelated cache keys',()=>{
 const local=new Storage(),session=new Storage(),old=snapshot({searchedAt:'2020-01-01T12:00:00Z',updatedAt:'2020-01-01T13:00:00Z'});local.setItem(WORKSPACE_KEY,JSON.stringify(old));local.setItem('orion-prospecta-cache-v1','[]');
 const loaded=loadWorkspace({local,session}).workspace;assert.equal(loaded.results.length,2);assert.equal(loaded.searchedAt,'2020-01-01T12:00:00.000Z');assert.equal(loaded.view,'review');
});

test('one invalid result cannot wipe valid records and duplicate IDs do not repeat cards',()=>{
 const valid=lead(1),restored=normalizeWorkspace(snapshot({results:[null,{...lead(2),lat:999},valid,{...valid,name:'Repeated ID'},lead(3),{id:'places/google',name:'Google result',lat:0,lon:0}]}));
 assert.deepEqual(restored.results.map(item=>item.id),['osm:node:1','osm:node:3']);assert.equal(restored.results[0].name,valid.name);
});

test('workspace whitelists only OSM source fields and never copies review or Google responses',()=>{
 const result={...lead(),websiteUri:'https://google-response.example',googleMapsUri:'https://maps.google.com',businessStatus:'CLOSED_PERMANENTLY',google:{place:'secret_google_result'},notes:'Personal CRM note',stage:'Contato feito',verified:'missing',reviewedAt:'2026-10-27T12:00:00Z',reviewUrl:'https://google-review.example',ignored:true,ignoredAt:'2026-10-27T12:00:00Z',apiKey:'PRIVATE_PLACEHOLDER'};
 const restored=normalizeWorkspace(snapshot({results:[result],apiKey:'PRIVATE_PLACEHOLDER',googleResults:[result]})),serialized=JSON.stringify(restored);
 assert.doesNotMatch(serialized,/google-response|google-review|googleMapsUri|businessStatus|secret_google_result|Personal CRM note|Contato feito|PRIVATE_PLACEHOLDER|reviewedAt|ignoredAt/);
 assert.equal(restored.results[0].verified,undefined);assert.equal(restored.results[0].ignored,undefined);assert.equal(digitalPresence(restored.results[0]).status,'unknown');assert.equal(canProspect(restored.results[0]),false);assert.equal(restored.results[0].ddd,47);
 const site=normalizeWorkspace(snapshot({results:[{...lead(),website:'https://source.example/',presenceLinks:[{kind:'menu',url:'https://source.example/menu'}]}]}));assert.equal(digitalPresence(site.results[0]).status,'exists');
});

test('invalid snapshots fall back to a valid mirror without discarding stored data',()=>{
 const local=new Storage(),session=new Storage();local.setItem(WORKSPACE_KEY,JSON.stringify(snapshot()));session.setItem(WORKSPACE_KEY,'{broken');
 const restored=loadWorkspace({local,session});assert.equal(restored.source,'local');assert.equal(restored.workspace.results.length,2);assert.ok(restored.errors.includes('session_invalid'));assert.equal(session.getItem(WORKSPACE_KEY),'{broken');
 assert.equal(normalizeWorkspace({version:2,results:[]}),null);assert.equal(normalizeWorkspace(null),null);assert.equal(loadWorkspace({local:new Storage(),session:new Storage()}).workspace,null);
});

test('local quota failure preserves the previous snapshot and a newer session restores current work',()=>{
 const local=new Storage(),session=new Storage();saveWorkspace(snapshot(),{local,session,now:()=>new Date('2026-10-27T12:02:00Z')});const old=local.getItem(WORKSPACE_KEY);local.failWrite=true;
 const result=saveWorkspace(snapshot({results:[lead(3)],listScrollTop:420}),{local,session,now:()=>new Date('2026-10-27T12:03:00Z')});
 assert.equal(result.ok,true);assert.equal(result.persistent,false);assert.equal(result.session,true);assert.ok(result.errors.includes('local_write_failed'));assert.equal(local.getItem(WORKSPACE_KEY),old);
 const resumed=loadWorkspace({local,session});assert.equal(resumed.source,'session');assert.equal(resumed.workspace.results[0].id,'osm:node:3');assert.equal(resumed.workspace.listScrollTop,420);
});

test('a stale session cannot hide a successful newer local save, even within one millisecond',()=>{
 const local=new Storage(),session=new Storage(),options={local,session,now:()=>new Date('2026-10-27T12:02:00Z')};saveWorkspace(snapshot(),options);const old=session.getItem(WORKSPACE_KEY);session.failWrite=true;
 const result=saveWorkspace(snapshot({results:[lead(4)]}),options);assert.equal(result.persistent,true);assert.equal(result.session,false);assert.equal(session.getItem(WORKSPACE_KEY),old);
 const loaded=loadWorkspace({local,session});assert.equal(loaded.source,'local');assert.equal(loaded.workspace.results[0].id,'osm:node:4');
});

test('returning from Google keeps each tab own search even when another tab saved later',()=>{
 const local=new Storage(),tabA=new Storage(),tabB=new Storage();
 saveWorkspace(snapshot({results:[lead(1)],filters:{name:'Busca A',sort:'name'},view:'review'}),{local,session:tabA,now:()=>new Date('2026-10-27T12:00:00Z')});
 const idA=tabA.getItem(WORKSPACE_TAB_KEY);
 saveWorkspace(snapshot({results:[lead(2)],filters:{name:'Busca B',sort:'distance'},view:'saved'}),{local,session:tabB,now:()=>new Date('2026-10-27T12:05:00Z')});
 const idB=tabB.getItem(WORKSPACE_TAB_KEY);assert.ok(idA);assert.ok(idB);assert.notEqual(idA,idB);
 const resumedA=loadWorkspace({local,session:tabA}),resumedB=loadWorkspace({local,session:tabB});
 assert.equal(resumedA.source,'session');assert.equal(resumedA.workspace.results[0].id,'osm:node:1');assert.equal(resumedA.workspace.filters.name,'Busca A');assert.equal(resumedA.workspace.view,'review');
 assert.equal(resumedB.workspace.results[0].id,'osm:node:2');assert.equal(resumedB.workspace.filters.name,'Busca B');
 saveWorkspace(snapshot({results:[lead(3)]}),{local,session:tabA,now:()=>new Date('2026-10-27T12:10:00Z')});
 assert.equal(loadWorkspace({local,session:tabB}).workspace.results[0].id,'osm:node:2');assert.equal(loadWorkspace({local,session:tabA}).workspace.results[0].id,'osm:node:3');
});

test('a new tab can resume the latest global search but gets a fresh writer on its first save',()=>{
 const local=new Storage(),firstTab=new Storage(),newTab=new Storage();
 saveWorkspace(snapshot(),{local,session:firstTab});const originalId=firstTab.getItem(WORKSPACE_TAB_KEY),resumed=loadWorkspace({local,session:newTab});
 assert.equal(resumed.source,'local');assert.equal(resumed.workspace.tabId,originalId);assert.equal(newTab.getItem(WORKSPACE_TAB_KEY),null);
 saveWorkspace({...resumed.workspace,results:[lead(4)],tabId:originalId},{local,session:newTab});const nextId=newTab.getItem(WORKSPACE_TAB_KEY);
 assert.notEqual(nextId,originalId);assert.equal(loadWorkspace({local,session:newTab}).workspace.tabId,nextId);assert.equal(loadWorkspace({local,session:firstTab}).workspace.tabId,originalId);
 const forged='forged-writer-not-this-tab';saveWorkspace({...resumed.workspace,tabId:forged},{local,session:newTab});assert.equal(JSON.parse(local.getItem(WORKSPACE_KEY)).tabId,nextId);assert.notEqual(nextId,forged);
});

test('same-tab local recovery still works without the marker when a valid tab snapshot survives',()=>{
 const local=new Storage(),session=new Storage();saveWorkspace(snapshot(),{local,session});const id=JSON.parse(session.getItem(WORKSPACE_KEY)).tabId;session.values.delete(WORKSPACE_TAB_KEY);session.failWrite=true;
 const result=saveWorkspace(snapshot({results:[lead(5)]}),{local,session});assert.equal(result.persistent,true);assert.equal(result.session,false);assert.equal(JSON.parse(local.getItem(WORKSPACE_KEY)).tabId,id);assert.equal(loadWorkspace({local,session}).workspace.results[0].id,'osm:node:5');
});

test('legacy snapshots without tab identifiers remain recoverable by newest timestamp',()=>{
 const local=new Storage(),session=new Storage();session.setItem(WORKSPACE_KEY,JSON.stringify(snapshot({results:[lead(1)],updatedAt:'2020-01-01T12:00:00Z'})));local.setItem(WORKSPACE_KEY,JSON.stringify(snapshot({results:[lead(2)],updatedAt:'2020-01-01T12:01:00Z'})));
 assert.equal(loadWorkspace({local,session}).source,'local');assert.equal(loadWorkspace({local,session}).workspace.results[0].id,'osm:node:2');
});

test('unavailable browser storage never throws or overwrites CRM records',()=>{
 const local=new Storage(),session=new Storage();local.setItem('orion-prospecta-v1','CRM snapshot must stay');local.failRead=true;session.failRead=true;assert.equal(loadWorkspace({local,session}).workspace,null);
 local.failWrite=true;session.failWrite=true;const failed=saveWorkspace(snapshot(),{local,session});assert.equal(failed.ok,false);assert.equal(failed.persistent,false);assert.equal(failed.session,false);
 local.failRead=false;assert.equal(local.getItem('orion-prospecta-v1'),'CRM snapshot must stay');assert.equal(saveWorkspace({version:2},{local,session}).ok,false);assert.equal(loadWorkspace({local:null,session:null}).workspace,null);
});

test('UI state is constrained to supported values and search records remain visible',()=>{
 const restored=normalizeWorkspace(snapshot({view:'made-up',search:{cityInput:'Cidade · SC',niche:'injected',radius:999},filters:{name:'Busca',contactOnly:'yes',stage:'invalid',sort:'invalid',presence:'invalid'},selectedId:'__proto__',listScrollTop:-50,mapView:{lat:999,lon:1,zoom:14},searched:false,city:{...city,lat:999}}));
 assert.equal(restored.view,'discover');assert.equal(restored.search.niche,'all');assert.equal(restored.search.radius,5);assert.equal(restored.filters.contactOnly,false);assert.equal(restored.filters.stage,'');assert.equal(restored.filters.sort,'distance');assert.equal(restored.filters.presence,'qualified');assert.equal(restored.selectedId,'');assert.equal(restored.listScrollTop,0);assert.equal(restored.mapView,null);assert.equal(restored.city,null);assert.equal(restored.searched,true);
 const limited=normalizeWorkspace(snapshot({results:Array.from({length:605},(_,index)=>lead(index+1))}));assert.equal(limited.results.length,600);
});
