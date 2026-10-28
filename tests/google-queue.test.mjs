import test from 'node:test';
import assert from 'node:assert/strict';
import {needsGoogleCheck} from '../dist/google-queue.mjs';
import {normalizeElement,canProspect} from '../dist/domain.mjs';

const city={name:'Cidade',uf:'SC',lat:-26.48,lon:-49.07};
const candidate=normalizeElement({type:'node',id:1,lat:city.lat,lon:city.lon,tags:{name:'Café Exemplo',facebook:'cafeexemplo'}},city);

test('a new social-only candidate can be checked without being qualified automatically',()=>{
 assert.equal(needsGoogleCheck(candidate,[]),true);assert.equal(canProspect(candidate),false);
});
test('every saved record stays out of Google regardless of review, stage, ignored flag or past result',()=>{
 for(const changes of [{verified:'unknown'},{verified:'missing',reviewedAt:'2026-10-28T12:00:00Z'},{verified:'exists'},{stage:'Conversando'},{ignored:true},{googleHistory:{checkedAt:'2026-10-28T12:00:00Z'}}]){
  assert.equal(needsGoogleCheck(candidate,[{...candidate,...changes}]),false,JSON.stringify(changes));
 }
 assert.equal(needsGoogleCheck({...candidate,name:'Nome atualizado',lat:-26.6},[candidate]),false);
});
test('a changed OSM ID for the same nearby business is excluded, while another branch remains eligible',()=>{
 const saved={...candidate,id:'osm:way:99',name:' CAFE EXEMPLO ',lat:candidate.lat+.0001};assert.equal(needsGoogleCheck(candidate,[saved]),false);
 assert.equal(needsGoogleCheck({...candidate,id:'osm:node:2',lat:-26.5},[saved]),true);
 assert.equal(needsGoogleCheck({...candidate,id:'osm:node:2',name:'Outro café'},[saved]),true);
});
test('removing a saved record restores eligibility without changing the record or saved notes',()=>{
 const saved={...candidate,notes:'Preservar notas',stage:'Proposta enviada'},snapshot=JSON.stringify(saved);
 assert.equal(needsGoogleCheck(candidate,[saved]),false);assert.equal(needsGoogleCheck(candidate,[]),true);assert.equal(JSON.stringify(saved),snapshot);
});
test('saved-list read failures block lookup, and known websites and ignored records stay excluded',()=>{
 for(const unreadable of [null,undefined,{}])assert.equal(needsGoogleCheck(candidate,unreadable),false);
 assert.equal(needsGoogleCheck({...candidate,ignored:true},[]),false);
 assert.equal(needsGoogleCheck({...candidate,website:'https://empresa.example'},[]),false);
});
