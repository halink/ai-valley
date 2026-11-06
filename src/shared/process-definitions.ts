import type {Inventory} from './types.js';
export const healthDefaults={appointmentMinutes:30,bookingWindow:120,selfMinutes:30,medicine:1,water:1,medicineEffect:35,minimumCare:1,criticalSeverity:85,criticalHealth:12,regainSeverity:60,regainHealth:20,slowSeverity:20,severeSeverity:50,slowRate:.75,severeRate:.5,badDaySeverity:1,treatedDaily:6,fedInjuryDaily:1,fedIllnessDaily:2,sleepDaily:3,criticalDrain:.004};
export type HealthRules=typeof healthDefaults;
export const careDefaults={visitMinutes:20,materials:{meal:1,water:1} as Inventory,maximumDays:28,healthGain:3};
export type CareRules=typeof careDefaults;

export const cultureDefaults={preparationMinutes:60,cost:{wedding:{wood:2,cloth:1,water:2},festival:{wood:2,water:2},memorial:{wood:1,herb:1,water:1}},minimumLead:30,maximumLead:20160,minimumWindow:30,maximumWindow:240,cleanupMinutes:20,salvageWood:1,openingConsentMinutes:10};
