import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createStaticServer, loadPlacesConfig } from '../scripts/serve.mjs';

async function fixture(t,options){
 const dir=await mkdtemp(join(tmpdir(),'prospecta-server-')),root=join(dir,'public');
 await mkdir(root);await writeFile(join(root,'index.html'),'<h1>Prospecta</h1>');await writeFile(join(root,'app.mjs'),'export const ready = true;');await writeFile(join(dir,'secret.txt'),'outside');
 const server=createStaticServer(root,options);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 return 'http://127.0.0.1:'+server.address().port;
}
test('local server serves the app and modules with browser-compatible MIME types',async t=>{
 const base=await fixture(t),home=await fetch(base+'/');
 assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(await home.text(),/Prospecta/);
 const module=await fetch(base+'/app.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
 const head=await fetch(base+'/app.mjs',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('local server refuses writes and does not expose files outside dist',async t=>{
 const base=await fixture(t),outside=await fetch(base+'/..%2fsecret.txt');
 assert.equal(outside.status,403);
 const post=await fetch(base+'/',{method:'POST',body:'no'});assert.equal(post.status,405);
 const missing=await fetch(base+'/missing');assert.equal(missing.status,404);
});

const requestHeaders={'Content-Type':'application/json','X-Prospecta-Request':'places-v1'};
test('Places routes remain optional and never expose environment files',async t=>{
 const base=await fixture(t),status=await fetch(base+'/api/places/status');
 assert.equal(status.status,200);assert.equal((await status.json()).enabled,false);assert.equal(status.headers.get('cache-control'),'no-store');
 const verify=await fetch(base+'/api/places/verify',{method:'POST',headers:requestHeaders,body:'{"candidate":{}}'});
 assert.equal(verify.status,503);assert.equal((await verify.json()).error.code,'NOT_CONFIGURED');
 for(const path of ['/.env','/.local/places-usage.json','/..%2f.env'])assert.equal((await fetch(base+path)).status,403,path);
});
test('Places accepts same-origin JSON POSTs and forwards only the candidate',async t=>{
 const received=[],result={status:'no_website_listed',checkedAt:'2026-10-27T12:00:00Z'};
 const base=await fixture(t,{placesService:{status:async()=>({enabled:true}),verify:async candidate=>{received.push(candidate);return result;}}});
 const candidate={name:'Empresa de teste',city:'Cidade · SC',lat:-26.48,lon:-49.07};
 const response=await fetch(base+'/api/places/verify',{method:'POST',headers:{...requestHeaders,Origin:base},body:JSON.stringify({candidate,monthlyLimit:999999,apiKey:'ignored-client-value'})});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.deepEqual(received,[candidate]);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('Places rejects cross-origin requests, DNS rebinding, unsafe methods and oversized bodies before lookup',async t=>{
 let lookups=0;const base=await fixture(t,{placesService:{status:async()=>({enabled:true}),verify:async()=>{lookups++;return {};}}});
 const payload={method:'POST',headers:requestHeaders,body:'{"candidate":{}}'};
 const cases=[
  {options:{...payload,headers:{...requestHeaders,Origin:'https://outside.example'}},expected:403},
  {options:{...payload,headers:{...requestHeaders,Origin:'null'}},expected:403},
  {options:{...payload,headers:{...requestHeaders,'Sec-Fetch-Site':'cross-site'}},expected:403},
  {options:{...payload,headers:{'Content-Type':'application/json'}},expected:403},
  {options:{...payload,headers:{...requestHeaders,'Content-Type':'text/plain'}},expected:403},
  {options:{method:'GET'},expected:405},
  {options:{method:'OPTIONS'},expected:405},
  {options:{...payload,body:'invalid json'},expected:400},
  {options:{...payload,body:JSON.stringify({candidate:'x'.repeat(9000)})},expected:413}
 ];
 for(const item of cases){const response=await fetch(base+'/api/places/verify',item.options);assert.equal(response.status,item.expected,JSON.stringify(item.options.headers||item.options));}
 const rebound=await new Promise((resolve,reject)=>{const req=request(base+'/api/places/verify',{method:'POST',headers:{...requestHeaders,Host:'outside.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(payload.body);});
 assert.equal(rebound,403);
 assert.equal(lookups,0);
});
test('unexpected service errors never disclose credentials or raw Google responses',async t=>{
 const base=await fixture(t,{placesService:{status:async()=>({enabled:true}),verify:async()=>{throw new Error('SYNTHETIC_PRIVATE_KEY raw provider response');}}});
 const response=await fetch(base+'/api/places/verify',{method:'POST',headers:requestHeaders,body:'{"candidate":{}}'});
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SYNTHETIC_PRIVATE_KEY|raw provider response/);
});
test('native env loading keeps credentials server-side and supports only lower limit settings',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'prospecta-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'.env'),'PLACESAPI="synthetic-test-key"\nPLACES_MONTHLY_LIMIT=200\nPLACES_DAILY_LIMIT=5\n');
 const config=await loadPlacesConfig(dir,{});assert.equal(config.apiKey,'synthetic-test-key');assert.equal(config.monthlyLimit,200);assert.equal(config.dailyLimit,5);assert.equal(config.usageFile,join(dir,'.local/places-usage.json'));
 const override=await loadPlacesConfig(dir,{PLACESAPI:'environment-test-key',PLACES_DAILY_LIMIT:'0'});assert.equal(override.apiKey,'environment-test-key');assert.equal(override.dailyLimit,0);
});
