import {sameBusiness,digitalPresence} from './domain.mjs';

// Saving to the personal list is an explicit decision to leave the Google queue,
// regardless of stage, qualification, previous Google results or current OSM ID.
export function needsGoogleCheck(candidate,saved){
 return !!candidate&&Array.isArray(saved)&&candidate.ignored!==true&&digitalPresence(candidate).status!=='exists'&&!saved.some(lead=>sameBusiness(lead,candidate));
}
