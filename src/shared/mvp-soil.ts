/** Exact numerator strings. Denominator is fixed by integrator v1, never a float. */
export interface SoilAmounts {water:string;snow:string;initial:string;rainIn:string;snowIn:string;melt:string;irrigation:string;evaporation:string;drainage:string;}
export interface SoilRates {rain:string;snow:string;melt:string;evaporation:string;}
export interface SoilPlot {plotId:string;segment:{startUs:string;endUs:string;gridUs:string;sampleUs:string;cellEndUs:string;start:SoilAmounts;rates:SoilRates};current:SoilAmounts;}
export interface SoilWaterReceipt {executionId:string;actorId:string;plotId:string;atUs:string;eventId:string;}
export interface MvpSoilState {schemaVersion:1;integratorVersion:1;parameterFingerprint:string;denominator:string;adoptedMinute:number;adoptedUs:string;lastUs:string;nextWaterExecutionSeq:string;plots:SoilPlot[];waterReceipts:Record<string,SoilWaterReceipt>;}
export interface MvpSoilObservation {schemaVersion:1;denominator:string;atUs:string;plots:Array<{plotId:string;paw:number;snowWater:number;initialPaw:50;rainIn:number;snowIn:number;melt:number;irrigation:number;evaporation:number;drainage:number;cropUse:0;exact:SoilAmounts}>;}
