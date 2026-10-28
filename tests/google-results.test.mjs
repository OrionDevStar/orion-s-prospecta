import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleResultSession,normalizeGoogleResult} from '../dist/google-results.mjs';

test('old backend replies naming a social URL as a website are corrected before display',()=>{
 for(const [websiteUri,status] of [['https://facebook.com/azcafebar','social_only'],['https://instagram.com/azcafebar','social_only'],['https://linktr.ee/azcafebar','links_only'],['https://az.safeh.app','found_website']]){
  const raw={status:'found_website',place:{websiteUri}};assert.equal(normalizeGoogleResult(raw).status,status);assert.equal(raw.status,'found_website');
 }
 for(const status of ['closed_permanently','closed_temporarily','ambiguous'])assert.equal(normalizeGoogleResult({status,place:{websiteUri:'https://facebook.com/empresa'}}).status,status);
});
test('a live result can be restored by another page without persistent storage or a new query',()=>{
 const session=createGoogleResultSession(),result={status:'found_website',place:{id:'test-place',websiteUri:'https://facebook.com/azcafebar',displayName:'AZ Café Bar'}};
 assert.equal(session.set('osm:node:1',result),true);result.place.displayName='Mutated';const restored=session.get('osm:node:1');assert.equal(restored.place.displayName,'AZ Café Bar');assert.equal(restored.status,'social_only');
 restored.place.displayName='Another mutation';assert.equal(session.get('osm:node:1').place.displayName,'AZ Café Bar');assert.equal(createGoogleResultSession().get('osm:node:1'),null);
});
test('live sessions keep failures without creating a successful result and reject invalid source IDs',()=>{
 const session=createGoogleResultSession();assert.equal(session.set('google:1',{status:'social_only'}),false);assert.equal(session.set('osm:node:1',{status:'invalid'}),false);assert.equal(session.get('osm:node:1'),null);
 assert.equal(session.set('osm:node:1',{status:'error',message:'Não foi possível consultar.'}),true);assert.equal(session.get('osm:node:1').status,'error');
 for(let id=2;id<=601;id++)session.set('osm:node:'+id,{status:'not_found'});assert.equal(session.get('osm:node:1'),null);assert.equal(session.get('osm:node:601').status,'not_found');
});
