import {NICHES,distanceKm} from './domain.mjs';

export const DEFAULT_SEARCH_CENTER=Object.freeze({lat:-26.4851,lon:-49.0713,label:'Jaraguá do Sul · SC',mode:'city'});
export function normalizeSearchCenter(value){
 if(!value||typeof value.lat!=='number'||!Number.isFinite(value.lat)||Math.abs(value.lat)>90||typeof value.lon!=='number'||!Number.isFinite(value.lon)||Math.abs(value.lon)>180)return null;
 return {lat:Number(value.lat.toFixed(6)),lon:Number(value.lon.toFixed(6)),label:typeof value.label==='string'?value.label.slice(0,180):'Ponto no mapa',mode:value.mode==='city'?'city':'map'};
}
export function normalizeSearchArea(value){
 const center=normalizeSearchCenter(value);
 return center&&Object.hasOwn(NICHES,value.niche)&&[3,5,10,20].includes(value.radius)?{...center,niche:value.niche,radius:value.radius}:null;
}
export function searchAreaKey(value){
 const area=normalizeSearchArea(value);if(!area)throw new Error('Área de busca inválida.');
 return ['point',area.lat,area.lon,area.niche,area.radius].join(':');
}
export function sameSearchArea(first,second){return !!normalizeSearchArea(first)&&!!normalizeSearchArea(second)&&searchAreaKey(first)===searchAreaKey(second);}
export function nearestCity(point,cities,maximumKm=40){
 if(!normalizeSearchCenter(point)||!Array.isArray(cities))return null;
 let nearest=null,best=maximumKm;
 for(const city of cities){if(!normalizeSearchCenter(city)||!city.name)continue;const distance=distanceKm(point.lat,point.lon,city.lat,city.lon);if(distance<=best){nearest=city;best=distance;}}
 return nearest;
}
export function searchContext(area,cities){
 const center=normalizeSearchCenter(area);if(!center)throw new Error('Centro de busca inválido.');
 const city=nearestCity(center,cities),approximate=center.mode!=='city'||!city||distanceKm(center.lat,center.lon,city.lat,city.lon)>.1;
 return {...center,name:city?.name||'',uf:city?.uf||'',ddd:city?.ddd,approximate};
}
