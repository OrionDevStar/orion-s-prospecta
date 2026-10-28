import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SEARCH_CENTER,normalizeSearchCenter,normalizeSearchArea,searchAreaKey,sameSearchArea,nearestCity,searchContext} from '../dist/search-area.mjs';
import {normalizeElement,queryFor,distanceKm} from '../dist/domain.mjs';

const city={id:1,name:'Cidade de referência',uf:'SC',ddd:47,lat:-26.48,lon:-49.07};
const area={lat:-26.49,lon:-49.08,label:'Ponto no mapa',mode:'map',niche:'food',radius:3};
test('search areas accept arbitrary coordinates independently of any municipality',()=>{
 for(const point of [{lat:0,lon:0},{lat:51.5,lon:-.12},{lat:-26.49123456,lon:-49.08123456}]){
  const selected=normalizeSearchArea({...area,...point});assert.ok(selected);assert.match(queryFor(selected.niche,selected.lat,selected.lon,selected.radius),new RegExp('around:3000,'+selected.lat+','+selected.lon));
 }
 assert.deepEqual(normalizeSearchCenter(DEFAULT_SEARCH_CENTER),DEFAULT_SEARCH_CENTER);
 assert.equal(normalizeSearchCenter({...area,lat:'-26.49'}),null);assert.equal(normalizeSearchCenter({...area,lat:91}),null);assert.equal(normalizeSearchCenter({...area,lon:181}),null);assert.equal(normalizeSearchCenter({...area,lon:NaN}),null);
 assert.equal(normalizeSearchArea({...area,radius:999}),null);assert.equal(normalizeSearchArea({...area,niche:'invalid'}),null);
});
test('cache keys and area comparisons depend on coordinates, radius and niche rather than city labels',()=>{
 assert.equal(searchAreaKey(area),searchAreaKey({...area,label:'Outra legenda',mode:'city'}));
 assert.notEqual(searchAreaKey(area),searchAreaKey({...area,lat:-26.491}));assert.notEqual(searchAreaKey(area),searchAreaKey({...area,lon:-49.081}));
 assert.notEqual(searchAreaKey(area),searchAreaKey({...area,radius:5}));assert.notEqual(searchAreaKey(area),searchAreaKey({...area,niche:'beauty'}));
 assert.equal(sameSearchArea(area,{...area,label:'Outra legenda'}),true);assert.equal(sameSearchArea(area,null),false);assert.equal(sameSearchArea(area,{...area,radius:5}),false);
 assert.equal(normalizeSearchCenter({...area,lat:-26.49123456}).lat,-26.491235);
});
test('nearest municipality supplies context without changing the chosen search origin',()=>{
 assert.deepEqual(nearestCity(area,[{...city,lat:99},city]),city);const context=searchContext(area,[city]);assert.equal(context.lat,area.lat);assert.equal(context.lon,area.lon);assert.equal(context.approximate,true);
 const lead=normalizeElement({type:'node',id:1,lat:area.lat,lon:area.lon,tags:{name:'No ponto escolhido'}},context);assert.equal(lead.distance,0);assert.equal(lead.city,'Próximo a '+city.name+' · SC');
 const other=normalizeElement({type:'node',id:2,lat:city.lat,lon:city.lon,tags:{name:'Outro ponto'}},context);assert.equal(other.distance,distanceKm(area.lat,area.lon,city.lat,city.lon));assert.ok(other.distance>0);
});
test('places far from the municipality database remain searchable and do not inherit the last city',()=>{
 const point={...area,lat:51.5,lon:-.12},context=searchContext(point,[city]);assert.equal(nearestCity(point,[city]),null);assert.equal(context.name,'');
 const lead=normalizeElement({type:'node',id:1,lat:point.lat,lon:point.lon,tags:{name:'Sem cidade na fonte'}},context);assert.equal(lead.city,'Área de 51.5000, -0.1200');assert.equal(lead.distance,0);
});
test('address locality from OSM takes precedence over a nearby municipal reference',()=>{
 const lead=normalizeElement({type:'node',id:1,lat:area.lat,lon:area.lon,tags:{name:'Empresa','addr:city':'Município vizinho','addr:state':'PR'}},searchContext(area,[city]));assert.equal(lead.city,'Município vizinho · PR');
 const centered=searchContext({...area,lat:city.lat,lon:city.lon,mode:'city'},[city]);assert.equal(centered.approximate,false);
});
