import {classifyWebsite} from './domain.mjs';

export const GOOGLE_RESULT_STATUSES=new Set(['found_website','social_only','links_only','no_website_listed','ambiguous','not_found','closed_permanently','closed_temporarily','error']);
export function normalizeGoogleResult(result){
 if(!result||!GOOGLE_RESULT_STATUSES.has(result.status))return null;
 let status=result.status;
 if(['found_website','social_only','links_only','no_website_listed'].includes(status))status={solution:'found_website',social:'social_only',links:'links_only',none:'no_website_listed'}[classifyWebsite(result.place?.websiteUri)];
 return {...structuredClone(result),status};
}

// Live browser memory only. The application holds this for the Google view;
// no Google content is added to map markers, localStorage, sessionStorage or exports.
export function createGoogleResultSession(){
 const entries=new Map();
 return {
  get(id){const entry=entries.get(id);return entry?structuredClone(entry):null;},
  set(id,result){if(typeof id!=='string'||!/^osm:(node|way|relation):\d+$/.test(id))return false;const entry=normalizeGoogleResult(result);if(!entry)return false;entries.delete(id);entries.set(id,entry);if(entries.size>600)entries.delete(entries.keys().next().value);return true;}
 };
}
