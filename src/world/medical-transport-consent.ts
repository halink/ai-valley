import type {TransportOffer} from '../shared/health.js';
import type {Resident,World} from '../shared/types.js';
import {ageYears,knownAgeYears} from './time.js';

export const transportOfferOpen=(w:World,o:TransportOffer)=>['offered','accepted','awaitingPatient'].includes(o.status)&&o.expiresAt>w.minute;
/** The original addressee is evidence, not a mutable current decision maker.
 * Missing legacy timestamps remain missing; only a proven personal choice counts. */
export function transportPersonalConsent(w:World,o:TransportOffer,p:Resident):boolean {
 if(o.status!=='accepted'||knownAgeYears(p.bornAt,w.minute)===null)return false;
 if(o.personalAcceptedAt!==undefined)return typeof o.personalAcceptedAt==='number'&&Number.isFinite(o.personalAcceptedAt)&&Number.isFinite(o.createdAt)&&o.personalAcceptedAt>=o.createdAt&&o.personalAcceptedAt<=w.minute&&ageYears(p.bornAt,o.personalAcceptedAt)>=6;
 return o.respondentId===p.id&&Number.isFinite(o.createdAt)&&o.createdAt<=w.minute&&ageYears(p.bornAt,o.createdAt)>=6;
}
/** Under-six offers cannot carry proxy assent across the sixth birthday.
 * A separately made older minor's incapacity proxy keeps its existing scope. */
export function transportNeedsPersonalConsent(w:World,o:TransportOffer,p:Resident):boolean {
 const age=knownAgeYears(p.bornAt,w.minute);if(age===null)return true;
 if(age<6||transportPersonalConsent(w,o,p))return false;
 return o.status==='awaitingPatient'||knownAgeYears(p.bornAt,o.createdAt)===null||ageYears(p.bornAt,o.createdAt)<6||p.canDecide&&p.canExpress||ageYears(p.bornAt,w.minute)>=18;
}
export function transportConsentUsable(w:World,o:TransportOffer,p:Resident):boolean {
 const proxy=w.residents.find(r=>r.id===o.respondentId);
 return transportOfferOpen(w,o)&&o.status==='accepted'&&(transportPersonalConsent(w,o,p)||!transportNeedsPersonalConsent(w,o,p)&&!!proxy&&ageYears(proxy.bornAt,w.minute)>=18&&p.guardianIds.includes(proxy.id));
}
