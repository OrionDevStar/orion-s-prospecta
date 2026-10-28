import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlacesService,PlacesError,PLACES_ENDPOINT,PLACES_FIELD_MASK } from '../scripts/places.mjs';

const candidate={name:'Pizzaria Exemplo',city:'Cidade · SC',address:'Rua das Flores, 150',lat:-26.48,lon:-49.07,phoneNumber:'5547999991234'};
const place=(changes={})=>({id:'place_synthetic',displayName:{text:'Pizzaria Exemplo'},formattedAddress:'Rua das Flores, 150 - Cidade - SC',location:{latitude:-26.4801,longitude:-49.0701},nationalPhoneNumber:'(47) 99999-1234',websiteUri:'https://cardapio.example/pedir',googleMapsUri:'https://maps.google.com/?cid=123',businessStatus:'OPERATIONAL',attributions:[{provider:'Fonte de teste',providerUri:'https://provider.example/'}],...changes});
const ok=(places=[place()])=>new Response(JSON.stringify({places}),{status:200,headers:{'Content-Type':'application/json'}});
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'prospecta-places-'));t.after(()=>rm(dir,{recursive:true,force:true}));let time=new Date('2026-10-27T15:00:00.000Z');const calls=[];
 const config={apiKey:'synthetic-key-not-a-credential',usageFile:join(dir,'private','usage.json'),now:()=>time,fetchImpl:async(...args)=>{calls.push(args);return ok();},...options};
 return {dir,config,calls,service:createPlacesService(config),setTime:value=>{time=new Date(value);}};
}
const rejectsCode=(promise,code,status)=>assert.rejects(promise,error=>error instanceof PlacesError&&error.code===code&&(!status||error.httpStatus===status));

test('Places is optional, status is local and never exposes the key',async t=>{
 const f=await fixture(t,{apiKey:''}),status=await f.service.status();
 assert.equal(status.enabled,false);assert.equal(status.blockReason,'not_configured');assert.equal(status.monthly.limit,900);assert.equal(status.daily.limit,25);assert.equal(f.calls.length,0);
 await rejectsCode(f.service.verify(candidate),'not_configured',503);assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(status),/synthetic-key/);
});

test('one fixed Enterprise Text Search requests only the allowed fields and matches the business',async t=>{
 const f=await fixture(t),result=await f.service.verify(candidate),[url,request]=f.calls[0];
 assert.equal(f.calls.length,1);assert.equal(url,PLACES_ENDPOINT);assert.equal(request.headers['X-Goog-FieldMask'],PLACES_FIELD_MASK);assert.equal(request.headers['X-Goog-Api-Key'],f.config.apiKey);assert.equal(request.redirect,'error');
 const body=JSON.parse(request.body);assert.equal(body.pageSize,3);assert.equal(body.regionCode,'BR');assert.equal(body.languageCode,'pt-BR');assert.equal(body.locationBias.circle.radius,500);assert.match(body.textQuery,/Pizzaria Exemplo/);assert.equal(body.pageToken,undefined);assert.doesNotMatch(PLACES_FIELD_MASK,/reviews|photos|delivery|rating|\*/);
 assert.equal(result.status,'found_website');assert.equal(result.place.websiteUri,'https://cardapio.example/pedir');assert.equal(result.usage.monthly.used,1);assert.equal(result.usage.daily.used,1);assert.equal(result.place.attributions[0].provider,'Fonte de teste');
 assert.doesNotMatch(JSON.stringify(result),/synthetic-key/);
});

test('a missing website stays pending and is never proof of absence',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>ok([place({websiteUri:undefined})])}),result=await f.service.verify(candidate);
 assert.equal(result.status,'no_website_listed');assert.equal(result.place.websiteUri,'');assert.equal(result.verified,undefined);assert.equal(result.canProspect,undefined);
});

test('a social profile in websiteUri is an opportunity signal instead of an existing website',async t=>{
 for(const [websiteUri,status] of [['https://www.facebook.com/azcafebar','social_only'],['https://instagram.com/azcafebar','social_only'],['https://linktr.ee/azcafebar','links_only'],['https://az.safeh.app','found_website']]){
  let calls=0;const f=await fixture(t,{fetchImpl:async()=>{calls++;return ok([place({websiteUri})]);}}),result=await f.service.verify(candidate);
  assert.equal(result.status,status);assert.equal(result.place.websiteUri,websiteUri+(websiteUri.endsWith('.app')?'/':''));assert.equal(calls,1);assert.equal(result.canProspect,undefined);
 }
});

test('ambiguous branches, conflicting phones and distant namesakes do not become confident matches',async t=>{
 for(const alternatives of [
  [place(),place({id:'another_branch',location:{latitude:-26.4802,longitude:-49.0702}})],
  [place({nationalPhoneNumber:'(47) 98888-0000'})],
  [place({location:{latitude:-26.49,longitude:-49.08}})],
  [place({displayName:{text:'Outra Pizzaria'}})]
 ]){
  const f=await fixture(t,{fetchImpl:async()=>ok(alternatives)}),result=await f.service.verify(candidate);assert.equal(result.status,'ambiguous');assert.equal(result.place,undefined);
 }
});

test('a confident closed business is excluded for permanent or temporary closure before checking its site',async t=>{
 for(const [businessStatus,status] of [['CLOSED_PERMANENTLY','closed_permanently'],['CLOSED_TEMPORARILY','closed_temporarily']]){
  for(const websiteUri of ['https://cardapio.example/pedir','https://facebook.com/empresa',undefined]){
   let requests=0;const f=await fixture(t,{fetchImpl:async()=>{requests++;return ok([place({businessStatus,websiteUri})]);}}),result=await f.service.verify(candidate);
   assert.equal(result.status,status);assert.equal(result.place.businessStatus,businessStatus);assert.equal(result.alternatives,undefined);assert.equal(result.canProspect,undefined);assert.equal(requests,1);assert.equal(result.usage.daily.used,1);
  }
 }
});

test('a closed namesake or ambiguous branch does not declare the candidate closed',async t=>{
 for(const alternatives of [
  [place({businessStatus:'CLOSED_PERMANENTLY'}),place({id:'open_branch',location:{latitude:-26.4802,longitude:-49.0702}})],
  [place({businessStatus:'CLOSED_TEMPORARILY',nationalPhoneNumber:'(47) 98888-0000'})],
  [place({businessStatus:'CLOSED_PERMANENTLY',location:{latitude:-26.49,longitude:-49.08}})]
 ]){
  const f=await fixture(t,{fetchImpl:async()=>ok(alternatives)}),result=await f.service.verify(candidate);assert.equal(result.status,'ambiguous');assert.equal(result.place,undefined);assert.ok(result.alternatives.some(item=>item.businessStatus.startsWith('CLOSED_')));
 }
});

test('no result and malformed coordinates remain unqualified',async t=>{
 const none=await fixture(t,{fetchImpl:async()=>ok([])});assert.equal((await none.service.verify(candidate)).status,'not_found');
 const invalid=await fixture(t,{fetchImpl:async()=>ok([place({location:{latitude:999,longitude:-49}})])});assert.equal((await invalid.service.verify(candidate)).status,'ambiguous');
});

test('invalid candidates consume no quota and limits may only be lowered',async t=>{
 const f=await fixture(t);
 for(const value of [null,{},[candidate],{...candidate,lat:'-26.48'},{...candidate,lon:500},{...candidate,name:''}])await rejectsCode(f.service.verify(value),'invalid_candidate',400);
 assert.equal(f.calls.length,0);assert.equal((await f.service.status()).monthly.used,0);
 for(const options of [{monthlyLimit:901},{dailyLimit:26},{monthlyLimit:-1},{dailyLimit:1.2}])assert.throws(()=>createPlacesService({...f.config,...options}),TypeError);
 const stopped=createPlacesService({...f.config,monthlyLimit:0});await rejectsCode(stopped.verify(candidate),'monthly_limit',429);assert.equal(f.calls.length,0);
});

test('every attempted request consumes quota before fetch, including failures and timeouts',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>{const status=await f.service.status();assert.equal(status.monthly.used,1);throw new Error('contains synthetic-key-not-a-credential and raw response');}});
 await assert.rejects(f.service.verify(candidate),error=>error.code==='google_unavailable'&&!error.message.includes('synthetic-key')&&!error.message.includes('raw response'));
 assert.equal((await f.service.status()).monthly.used,1);
 const timeout=createPlacesService({...f.config,fetchImpl:async()=>{throw new DOMException('sensitive text','TimeoutError');}});await rejectsCode(timeout.verify(candidate),'google_timeout',504);assert.equal((await timeout.status()).monthly.used,2);
});

test('denied responses, quota errors and invalid JSON are sanitized without automatic retries',async t=>{
 for(const [response,code] of [[new Response('secret raw Google body',{status:403}),'google_denied'],[new Response('secret raw Google body',{status:429}),'google_quota'],[new Response('secret raw Google body',{status:500}),'google_unavailable'],[new Response('{invalid',{status:200}),'google_invalid_response'],[new Response('{"places":{}}',{status:200}),'google_invalid_response']]){
  let requests=0;const f=await fixture(t,{fetchImpl:async()=>{requests++;return response;}});await assert.rejects(f.service.verify(candidate),error=>error.code===code&&!error.message.includes('secret raw'));assert.equal(requests,1);assert.equal((await f.service.status()).daily.used,1);
 }
});

test('daily quota survives a new service and a changed API key',async t=>{
 const f=await fixture(t,{dailyLimit:2});await f.service.verify(candidate);await f.service.verify(candidate);await rejectsCode(f.service.verify(candidate),'daily_limit',429);
 const restarted=createPlacesService({...f.config,apiKey:'different-synthetic-key'});await rejectsCode(restarted.verify(candidate),'daily_limit',429);assert.equal(f.calls.length,2);assert.equal((await restarted.status()).daily.remaining,0);
});

test('concurrent callers and independent instances cannot exceed the reserved allowance',async t=>{
 const f=await fixture(t,{dailyLimit:2}),other=createPlacesService(f.config);
 const results=await Promise.allSettled(Array.from({length:12},(_,index)=>(index%2?f.service:other).verify(candidate)));
 assert.ok(results.filter(result=>result.status==='fulfilled').length<=2);assert.ok(f.calls.length<=2);assert.equal((await f.service.status()).daily.used,f.calls.length);
 for(const result of results.filter(result=>result.status==='rejected'))assert.ok(['busy','usage_locked','daily_limit'].includes(result.reason.code));
});

test('usage persists only timestamps and counts, never searches, business data or API keys',async t=>{
 const f=await fixture(t);await f.service.verify(candidate);const content=await readFile(f.config.usageFile,'utf8'),state=JSON.parse(content);
 assert.equal(state.events.length,1);assert.equal(state.lastAttemptAt,'2026-10-27T15:00:00.000Z');assert.doesNotMatch(content,/Pizzaria|Flores|synthetic-key|cardapio|place_synthetic|554799/);
});

test('missing usage after initialization and corrupted ledgers block requests instead of resetting them',async t=>{
 const missing=await fixture(t);await missing.service.verify(candidate);await unlink(missing.config.usageFile);await rejectsCode(missing.service.verify(candidate),'usage_unavailable',503);assert.equal(missing.calls.length,1);
 const corrupt=await fixture(t);await corrupt.service.verify(candidate);await writeFile(corrupt.config.usageFile,'{broken');await rejectsCode(corrupt.service.status(),'usage_unavailable',503);await rejectsCode(corrupt.service.verify(candidate),'usage_unavailable',503);assert.equal(corrupt.calls.length,1);
});

test('an existing lock or unwritable quota path blocks before any Google request',async t=>{
 const locked=await fixture(t);await mkdir(join(locked.dir,'private'));await writeFile(locked.config.usageFile+'.lock','held by another instance');await rejectsCode(locked.service.verify(candidate),'usage_locked',503);assert.equal(locked.calls.length,0);
 const f=await fixture(t);await writeFile(join(f.dir,'not-a-directory'),'fixture');const unavailable=createPlacesService({...f.config,usageFile:join(f.dir,'not-a-directory','usage.json')});await rejectsCode(unavailable.verify(candidate),'usage_unavailable',503);assert.equal(f.calls.length,0);
});

test('Pacific billing day/month and rolling allowance guard renewal boundaries',async t=>{
 const f=await fixture(t,{monthlyLimit:2,dailyLimit:1});f.setTime('2026-10-31T06:59:00.000Z');await f.service.verify(candidate); // Oct 30 Pacific
 f.setTime('2026-11-01T06:59:00.000Z');await f.service.verify(candidate); // Oct 31 Pacific
 assert.equal((await f.service.status()).monthly.used,2);
 f.setTime('2026-11-01T07:01:00.000Z');const renewed=await f.service.status();assert.equal(renewed.monthly.used,0);assert.equal(renewed.daily.used,0);assert.equal(renewed.blockReason,'rolling_limit');await rejectsCode(f.service.verify(candidate),'rolling_limit',429);
 f.setTime('2026-12-04T12:00:00.000Z');await f.service.verify(candidate);assert.equal((await f.service.status()).rolling.used,1);
});

test('moving the clock backwards cannot renew a previously spent allowance',async t=>{
 const f=await fixture(t);await f.service.verify(candidate);f.setTime('2026-09-27T15:00:00.000Z');assert.equal((await f.service.status()).blockReason,'clock_changed');await rejectsCode(f.service.verify(candidate),'clock_changed',503);assert.equal(f.calls.length,1);
});
