import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl,phoneDigits,queryFor,normalizeElement,uniqueLeads,csvCell,toCsv,validateBackup,distanceKm,digitalPresence,canProspect,mergePresenceLinks,sameBusiness,classifyWebsite} from '../dist/domain.mjs';
const city={id:1,name:'Cidade',uf:'SC',lat:-26.48,lon:-49.07,ddd:47};
const element=(tags={},id=1)=>({id,type:'node',lat:-26.48,lon:-49.07,tags:{name:'Empresa',...tags}});
test('missing website remains an unknown, social URL is not a standalone website',()=>{const a=normalizeElement(element({website:'https://instagram.com/negocio'}),city);assert.equal(a.website,'');assert.equal(a.instagram,'https://instagram.com/negocio');assert.equal(normalizeElement(element({website:'https://negocio.com.br'}),city).website,'https://negocio.com.br/');});
test('phone fallback does not claim confirmed WhatsApp',()=>{const a=normalizeElement(element({phone:'(47) 99999-1234'}),city);assert.equal(a.phoneNumber,'5547999991234');assert.equal(a.whatsappConfirmed,false);const b=normalizeElement(element({'contact:whatsapp':'+55 47 99999-1234'}),city);assert.equal(b.whatsappConfirmed,true);assert.equal(phoneDigits('not a phone 12345'),'');});
test('untrusted URLs cannot execute scripts or disguise a host behind credentials',()=>{assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('data:text/html,anything'),'');assert.equal(safeUrl('https://instagram.com@evil.example/negocio'),'');assert.equal(safeUrl('https://usuario:senha@example.com'),'');assert.equal(safeUrl('empresa.com.br'),'https://empresa.com.br/');});
test('explicit WhatsApp URLs preserve international country codes',()=>{assert.equal(phoneDigits('https://wa.me/5547999991234'),'5547999991234');assert.equal(phoneDigits('https://api.whatsapp.com/send?phone=5547999991234'),'5547999991234');assert.equal(phoneDigits('https://example.com/5547999991234'),'');assert.equal(phoneDigits('+1 212 555 0123'),'12125550123');});
test('Overpass query validates radius, coordinates and category',()=>{assert.match(queryFor('repair',-26,-49,3),/out tags center 600/);assert.throws(()=>queryFor('repair',NaN,0,3));assert.throws(()=>queryFor('repair',-26,-49,900));assert.throws(()=>queryFor('injection";',-26,-49,3));});
test('nearby duplicates merge, different branches stay distinct',()=>{const a=normalizeElement(element(),city),b=normalizeElement(element({},2),city),c=normalizeElement({...element({},3),lat:-26.5},city);assert.equal(uniqueLeads([a,b,c]).length,2);assert.equal(distanceKm(-26,-49,-26,-49),0);});
test('same business matches a changed OSM ID at the same location without merging distant branches',()=>{
 const original=normalizeElement(element({name:'Café Exemplo'}),city);
 const changedId=normalizeElement({...element({name:'  CAFE EXEMPLO  '},2),type:'way',lat:-26.4801},city);
 const distantBranch=normalizeElement({...element({name:'Café Exemplo'},3),lat:-26.5},city);
 assert.equal(sameBusiness(original,changedId),true);
 assert.equal(sameBusiness(original,distantBranch),false);
 assert.equal(sameBusiness(original,{...original,name:'Nome atualizado',lat:-26.5}),true);
 assert.equal(sameBusiness(original,{...changedId,name:'Outro negócio'}),false);
});
test('CSV preserves quoted newlines and neutralizes spreadsheet formula injection',()=>{assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');assert.equal(csvCell('  +SUM(1,2)'),'"\'  +SUM(1,2)"');const csv=toCsv([{...normalizeElement(element(),city),notes:'linha 1\nlinha "2"'}]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('linha 1\nlinha ""2""'));assert.ok(csv.includes('opendatacommons.org'));});
test('backup roundtrip retains status and notes while removing unknown fields',()=>{const l={...normalizeElement(element(),city),stage:'Conversando',notes:'Ligar amanhã',verified:'missing',reviewedAt:'2026-10-27T12:00:00.000Z',unexpected:'drop'};const restored=validateBackup({version:1,leads:[l]})[0];assert.equal(restored.notes,'Ligar amanhã');assert.equal(restored.stage,'Conversando');assert.equal(restored.unexpected,undefined);assert.equal(restored.verified,'missing');assert.equal(restored.reviewedAt,l.reviewedAt);assert.equal(canProspect(restored),true);});
test('backup rejects invalid geometry, format and IDs',()=>{assert.throws(()=>validateBackup({version:2,leads:[]}));assert.throws(()=>validateBackup({version:1,leads:[{...normalizeElement(element(),city),lat:999}]}));assert.throws(()=>validateBackup({version:1,leads:[{...normalizeElement(element(),city),id:'__proto__'}]}));});

test('missing OSM fields never qualify a business, even with phone contact',()=>{
 const lead=normalizeElement(element({phone:'(47) 3000-0000'}),city);
 assert.equal(digitalPresence(lead).status,'unknown');
 assert.equal(canProspect(lead),false);
 assert.equal(canProspect({...lead,verified:'missing'}),false);
 assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'invalid'}),false);
 assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-02-30T12:00:00Z'}),false);
 assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-10-27T12:00:00'}),false);
 assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-10-27T12:00:00.000Z'}),true);
});

test('menus, ordering and booking URLs count as existing online solutions',()=>{
 for(const tags of [
  {'website:menu':'https://pizzaria-exemplo.safeh.app'},
  {menu:'https://exemplo.com/cardapio.pdf'},
  {'contact:menu':'https://exemplo.com/menu'},
  {'menu:website':'https://exemplo.com/menu'},
  {'delivery:website':'https://exemplo.com/pedir'},
  {'contact:delivery':'https://www.ifood.com.br/delivery/cidade/restaurante'},
  {'order:website':'https://exemplo.com/pedido'},
  {'reservation:website':'https://exemplo.com/reservar'},
  {'booking:url':'https://exemplo.com/agendamento'}
 ]){
  const lead=normalizeElement(element(tags),city);
  assert.equal(digitalPresence(lead).status,'exists',JSON.stringify(tags));
  assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-10-27T12:00:00Z'}),false);
 }
 const menu=normalizeElement(element({'website:menu':'https://pizzaria-exemplo.safeh.app'}),city);
 assert.equal(menu.presenceLinks[0].kind,'ordering');
 assert.match(digitalPresence(menu).label,/Cardápio/);
});

test('every supplied website is checked while social and link profiles alone stay candidates',()=>{
 const lead=normalizeElement(element({'contact:website':'https://instagram.com/pizzaria',website:'https://pizzaria.com.br',url:'https://linktr.ee/pizzaria','contact:facebook':'pizzaria.local','contact:instagram':'@pizzaria.local'}),city);
 assert.equal(lead.website,'https://pizzaria.com.br/');
 assert.equal(lead.presenceLinks.length,5);
 assert.equal(digitalPresence(lead).status,'exists');
 assert.ok(lead.presenceLinks.some(link=>link.url==='https://www.instagram.com/pizzaria.local'));
 for(const tags of [{instagram:'@pizzaria.local'},{facebook:'pizzaria'},{'contact:tiktok':'pizzaria'},{website:'https://linktr.ee/pizzaria'}]){
  const lead=normalizeElement(element(tags),city);assert.equal(digitalPresence(lead).status,'unknown',JSON.stringify(tags));assert.equal(canProspect(lead),false);assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-10-28T12:00:00Z'}),true);
 }
 assert.equal(digitalPresence(normalizeElement(element({'contact:website':'javascript:alert(1)',website:'pizzaria.com.br'}),city)).status,'exists');
});

test('Facebook and Instagram remain potential opportunities and a website still overrides a social-only review',()=>{
 for(const url of ['https://www.facebook.com/azcafebar','https://m.facebook.com/azcafebar','https://fb.me/azcafebar','https://www.instagram.com/azcafebar']){
  assert.equal(classifyWebsite(url),'social');const lead=normalizeElement(element({website:url}),city),presence=digitalPresence(lead);
  assert.equal(presence.socialOnly,true);assert.equal(presence.solutions.length,0);assert.match(presence.label,/potencial oportunidade/);
  const checked={...lead,verified:'missing',reviewedAt:'2026-10-28T12:00:00Z',reviewScope:'website'};assert.equal(canProspect(checked),true);
  assert.equal(canProspect({...checked,presenceLinks:[...lead.presenceLinks,{kind:'menu',url:'https://menu.example/cardapio'}]}),false);
 }
 for(const url of ['https://empresa.example/','https://pizzaria.safeh.app/','https://wa.me/c/5547999991234'])assert.equal(classifyWebsite(url),'solution');
 assert.equal(classifyWebsite('https://linktr.ee/empresa'),'links');assert.equal(classifyWebsite('https://wa.me/5547999991234'),'none');
 assert.equal(classifyWebsite('https://facebook.com.example/menu'),'solution');
});

test('old social-only exclusions return to review without losing notes, while deliberate website reviews remain intact',()=>{
 const lead={...normalizeElement(element({facebook:'azcafebar'}),city),verified:'exists',reviewedAt:'2026-10-27T12:00:00Z',notes:'Preservar nota',stage:'Conversando'};
 const restored=validateBackup({version:1,leads:[lead]})[0];assert.equal(restored.verified,'unknown');assert.equal(restored.reviewedAt,'');assert.equal(restored.notes,lead.notes);assert.equal(restored.stage,lead.stage);assert.equal(restored.presenceLinks.length,1);assert.equal(canProspect(restored),false);
 const explicit=validateBackup({version:1,leads:[{...lead,reviewScope:'website'}]})[0];assert.equal(explicit.verified,'exists');assert.equal(digitalPresence(explicit).status,'exists');
 const realSite=validateBackup({version:1,leads:[{...lead,website:'https://empresa.example'}]})[0];assert.equal(realSite.verified,'exists');assert.equal(canProspect(realSite),false);
});

test('boolean fields, invalid URLs and standalone WhatsApp do not invent a site',()=>{
 for(const tags of [{menu:'yes',delivery:'yes',reservation:'required'},{website:'no'},{website:'javascript:alert(1)',menu:'data:text/html,foo'},{website:'https://wa.me/5547999991234'},{'contact:whatsapp':'+55 47 99999-1234'}]){
  const lead=normalizeElement(element(tags),city);
  assert.equal(digitalPresence(lead).status,'unknown',JSON.stringify(tags));
  assert.equal(lead.presenceLinks.length,0);
 }
 const whatsapp=normalizeElement(element({website:'https://wa.me/5547999991234'}),city);
 assert.equal(whatsapp.whatsapp,'https://wa.me/5547999991234');
 assert.equal(whatsapp.whatsappConfirmed,true);
});

test('duplicate records cannot lose evidence from a menu or another website',()=>{
 const first=normalizeElement(element(),city),second=normalizeElement(element({'website:menu':'https://exemplo.com/menu'},2),city);
 const merged=uniqueLeads([first,second]);
 assert.equal(merged.length,1);
 assert.equal(digitalPresence(merged[0]).status,'exists');
 assert.equal(merged[0].presenceLinks[0].kind,'menu');
 assert.equal(mergePresenceLinks(second.presenceLinks,second.presenceLinks).length,1);
});

test('explicit WhatsApp catalogs count as online ordering while direct chats remain contact only',()=>{
 for(const tags of [
  {website:'https://wa.me/c/5547999991234'},
  {'contact:whatsapp':'https://wa.me/c/5547999991234'},
  {'contact:website':'https://www.whatsapp.com/catalog/123456789/'}
 ]){
  const lead=normalizeElement(element(tags),city);
  assert.equal(digitalPresence(lead).status,'exists',JSON.stringify(tags));
  assert.equal(lead.presenceLinks[0].kind,'ordering');
  assert.equal(canProspect({...lead,verified:'missing',reviewedAt:'2026-10-27T12:00:00Z'}),false);
 }
 for(const url of ['https://wa.me/5547999991234?text=Quero%20um%20pedido','https://api.whatsapp.com/send?phone=5547999991234&text=Cardapio','https://www.whatsapp.com/send?phone=5547999991234']){
  const lead=normalizeElement(element({website:url}),city);
  assert.equal(digitalPresence(lead).status,'unknown',url);
  assert.equal(lead.whatsapp,'https://wa.me/5547999991234');
 }
});

test('mixed URL lists retain every solution while dropping chat links and unsafe protocols',()=>{
 const lead=normalizeElement(element({website:'javascript:alert(1); https://wa.me/5547999991234; https://empresa.example/menu https://empresa.example/pedir, https://linktr.ee/empresa','contact:instagram':'@empresa.local; https://instagram.com/empresa.segunda'}),city);
 assert.deepEqual(lead.presenceLinks.map(link=>link.url),['https://empresa.example/menu','https://empresa.example/pedir','https://linktr.ee/empresa','https://www.instagram.com/empresa.local','https://instagram.com/empresa.segunda']);
 assert.equal(digitalPresence(lead).status,'exists');
 assert.equal(lead.instagram,'https://www.instagram.com/empresa.local');
 assert.equal(lead.whatsapp,'https://wa.me/5547999991234');
 assert.deepEqual(mergePresenceLinks([{kind:'menu',url:'https://wa.me/c/5547999991234'},{kind:'ordering',url:'https://api.whatsapp.com/send?phone=5547999991234'},{kind:'website',url:'data:text/html,alert(1)'},{kind:'social',url:'https://instagram.com@evil.example/empresa'}]),[{kind:'ordering',url:'https://wa.me/c/5547999991234'}]);
 assert.deepEqual(mergePresenceLinks([{kind:'website',url:'https://wa.me/5547999991234; https://empresa.example'}]),[{kind:'website',url:'https://empresa.example/'}]);
});

test('a reviewed solution and imported evidence override a conflicting missing declaration',()=>{
 const base=normalizeElement(element(),city);
 const checked={...base,verified:'exists',reviewedAt:'2026-10-27T12:00:00Z',reviewUrl:'https://exemplo.com/cardapio'};
 const restored=validateBackup({version:1,leads:[checked]})[0];
 assert.equal(restored.reviewUrl,checked.reviewUrl);
 assert.equal(digitalPresence(restored).status,'exists');
 assert.equal(canProspect({...restored,verified:'missing'}),false);
 assert.equal(canProspect({...checked,verified:'missing'}),false);
 const withMenu=validateBackup({version:1,leads:[{...base,verified:'missing',reviewedAt:'2026-10-27T12:00:00Z',presenceLinks:[{kind:'menu',url:'https://exemplo.com/menu'},{kind:'website',url:'javascript:alert(1)'},{kind:'unknown',url:'https://exemplo.com'}]}]})[0];
 assert.equal(withMenu.presenceLinks.length,2);
 assert.equal(withMenu.presenceLinks[1].kind,'website');
 assert.equal(canProspect(withMenu),false);
});

test('legacy missing declarations need a new review and do not become qualified during migration',()=>{
 const legacy={...normalizeElement(element(),city),verified:'missing',stage:'Selecionado',notes:'Preservar'};
 const restored=validateBackup({version:1,leads:[legacy]})[0];
 assert.equal(restored.verified,'unknown');
 assert.equal(restored.stage,'Selecionado');
 assert.equal(restored.notes,'Preservar');
 assert.equal(canProspect(restored),false);
});

test('CSV exports qualification and evidence instead of inferring missing from OSM',()=>{
 const lead=normalizeElement(element({'website:menu':'https://exemplo.com/menu'}),city),csv=toCsv([lead]);
 assert.ok(csv.includes('"presenca_digital";"apto_para_prospeccao";"evidencias_presenca";"revisado_em";"solucao_encontrada"'));
 assert.ok(csv.includes('"exists";"não";"menu: https://exemplo.com/menu"'));
});

test('ignoring a business blocks prospecting without claiming digital presence',()=>{
 const lead=normalizeElement(element(),city),reviewed={...lead,verified:'missing',reviewedAt:'2026-10-27T12:00:00Z'};
 assert.equal(digitalPresence({...lead,ignored:true}).status,'unknown');
 assert.equal(digitalPresence({...reviewed,ignored:true}).status,'missing');
 assert.equal(canProspect(reviewed),true);
 assert.equal(canProspect({...reviewed,ignored:true}),false);
 assert.equal(canProspect({...reviewed,ignored:false}),true);
 const existing={...normalizeElement(element({website:'https://exemplo.com'}),city),ignored:true};
 assert.equal(digitalPresence(existing).status,'exists');
 assert.equal(canProspect(existing),false);
});

test('backups preserve explicit ignore decisions and their valid timestamp across reloads',()=>{
 const lead={...normalizeElement(element(),city),stage:'Revisar',notes:'Não é o perfil procurado',ignored:true,ignoredAt:'2026-10-27T09:00:00-03:00',verified:'missing',reviewedAt:'2026-10-27T12:00:00Z'};
 const restored=validateBackup({version:1,leads:[lead]})[0];
 assert.equal(restored.ignored,true);assert.equal(restored.ignoredAt,'2026-10-27T12:00:00.000Z');assert.equal(restored.notes,lead.notes);assert.equal(restored.stage,lead.stage);assert.equal(canProspect(restored),false);
 const reloaded=validateBackup(JSON.parse(JSON.stringify({version:1,leads:[restored]})))[0];assert.equal(reloaded.ignored,true);assert.equal(canProspect(reloaded),false);
 const legacy=validateBackup({version:1,leads:[normalizeElement(element(),city)]})[0];assert.equal(legacy.ignored,false);assert.equal(legacy.ignoredAt,'');
 const invalidDate=validateBackup({version:1,leads:[{...lead,ignoredAt:'2026-02-30T12:00:00Z'}]})[0];assert.equal(invalidDate.ignored,true);assert.equal(invalidDate.ignoredAt,'');assert.equal(canProspect(invalidDate),false);
 const restoredChoice=validateBackup({version:1,leads:[{...lead,ignored:false}]})[0];assert.equal(restoredChoice.ignored,false);assert.equal(restoredChoice.ignoredAt,'');assert.equal(canProspect(restoredChoice),true);
});

test('deduplicating an ignored business cannot restore it as an opportunity',()=>{
 const original={...normalizeElement(element(),city),verified:'missing',reviewedAt:'2026-10-27T12:00:00Z'},duplicate={...normalizeElement(element({},2),city),ignored:true,ignoredAt:'2026-10-27T13:00:00Z'};
 const combined=uniqueLeads([original,duplicate]);assert.equal(combined.length,1);assert.equal(combined[0].ignored,true);assert.equal(combined[0].ignoredAt,'2026-10-27T13:00:00.000Z');assert.equal(canProspect(combined[0]),false);
});

test('CSV distinguishes ignored records from qualified businesses and preserves ignore date',()=>{
 const lead={...normalizeElement(element(),city),verified:'missing',reviewedAt:'2026-10-27T12:00:00Z',ignored:true,ignoredAt:'2026-10-27T13:00:00Z'},csv=toCsv([lead]);
 assert.ok(csv.includes('"solucao_encontrada";"ignorado";"ignorado_em"'));
 assert.ok(csv.includes('"missing";"não";'));
 assert.ok(csv.endsWith(';"sim";"2026-10-27T13:00:00.000Z"'));
});
