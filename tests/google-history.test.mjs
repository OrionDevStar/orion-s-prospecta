import test from 'node:test';
import assert from 'node:assert/strict';
import {GOOGLE_HISTORY_KEY,loadGoogleHistory,recordGoogleCheck,normalizeGoogleHistory,getGoogleCheck,googleMapsUrl} from '../dist/google-history.mjs';

const check={id:'osm:node:1',checkedAt:'2026-10-28T12:00:00.000Z',placeId:'ChIJ_test-1'};
function storage(){let raw=null;return {getItem(key){assert.equal(key,GOOGLE_HISTORY_KEY);return raw;},setItem(key,value){assert.equal(key,GOOGLE_HISTORY_KEY);raw=value;},raw:()=>raw,replace:value=>{raw=value;}};}
test('consultation history survives reload with only source ID, activity timestamp and Place ID',()=>{
 const database=storage();assert.deepEqual(loadGoogleHistory(database),{ok:true,entries:[]});
 const reply=recordGoogleCheck({...check,name:'Google name',websiteUri:'https://google-only.example',businessStatus:'CLOSED_PERMANENTLY',raw:{secret:'never store'}},database);
 assert.equal(reply.ok,true);assert.deepEqual(loadGoogleHistory(database).entries,[check]);
 assert.equal(database.raw().includes('google-only'),false);assert.equal(database.raw().includes('CLOSED'),false);assert.equal(database.raw().includes('secret'),false);
 assert.deepEqual(getGoogleCheck({id:check.id},reply.entries),check);assert.equal(getGoogleCheck({id:'osm:way:1'},reply.entries),null);
});
test('independent tabs append checks, preserve previous Place ID and keep the latest timestamp',()=>{
 const database=storage();recordGoogleCheck(check,database);recordGoogleCheck({...check,id:'osm:way:2'},database);
 recordGoogleCheck({...check,checkedAt:'2026-10-28T13:00:00Z',placeId:''},database);
 recordGoogleCheck({...check,checkedAt:'2026-10-27T12:00:00Z',placeId:'Older_id'},database);
 const entries=loadGoogleHistory(database).entries;assert.equal(entries.length,2);assert.equal(entries[0].checkedAt,'2026-10-28T13:00:00.000Z');assert.equal(entries[0].placeId,check.placeId);
 recordGoogleCheck({...check,checkedAt:'2026-10-29T13:00:00Z',placeId:'New_id'},database);assert.equal(loadGoogleHistory(database).entries[0].placeId,'New_id');
});
test('malformed or unreadable history and quota failures preserve the previous data',()=>{
 for(const raw of ['{bad',JSON.stringify({version:99,entries:[]}),JSON.stringify({version:1,entries:[{...check,checkedAt:'2026-02-30T12:00:00Z'}]})]){
  const database=storage();database.replace(raw);assert.equal(loadGoogleHistory(database).ok,false);assert.equal(recordGoogleCheck(check,database).ok,false);assert.equal(database.raw(),raw);
 }
 assert.equal(recordGoogleCheck(check,{getItem(){throw new Error();}}).ok,false);
 const database=storage();recordGoogleCheck(check,database);const raw=database.raw();database.setItem=()=>{throw new Error('quota');};assert.equal(recordGoogleCheck({...check,id:'osm:node:2'},database).ok,false);assert.equal(database.raw(),raw);
});
test('invalid source IDs and dates cannot create checks; unsafe Place IDs never become URLs',()=>{
 const database=storage();for(const invalid of [{...check,id:'google:1'},{...check,checkedAt:'yesterday'},{...check,checkedAt:'2026-13-01T12:00:00Z'}])assert.equal(recordGoogleCheck(invalid,database).ok,false);
 assert.equal(database.raw(),null);const [clean]=normalizeGoogleHistory([{...check,placeId:'https://malicious.example'}]);assert.equal(clean.placeId,'');
 const url=new URL(googleMapsUrl({name:'A & B',city:'São Paulo'},clean));assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('query'),'A & B São Paulo');assert.equal(url.searchParams.has('query_place_id'),false);
});
test('Maps profile links use an existing Place ID without an API key and respect the URL length limit',()=>{
 const url=new URL(googleMapsUrl({name:'Pizzaria',city:'Jaraguá do Sul'},check));assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('query_place_id'),check.placeId);assert.equal(url.searchParams.has('key'),false);
 assert.ok(googleMapsUrl({name:'🍕'.repeat(300),city:'á'.repeat(150)},check).length<=2048);
});
test('history is bounded and duplicate source IDs keep the latest check',()=>{
 const duplicate=normalizeGoogleHistory([check,{...check,checkedAt:'2026-10-29T12:00:00Z',placeId:''}]);assert.equal(duplicate.length,1);assert.equal(duplicate[0].placeId,check.placeId);
 const database=storage();database.replace(JSON.stringify({version:1,entries:Array.from({length:5000},(_,id)=>({...check,id:'osm:node:'+id}))}));
 assert.equal(recordGoogleCheck({...check,id:'osm:node:5001',checkedAt:'2026-10-29T12:00:00Z'},database).ok,true);assert.equal(loadGoogleHistory(database).entries.length,5000);assert.equal(loadGoogleHistory(database).entries[0].id,'osm:node:5001');
});
