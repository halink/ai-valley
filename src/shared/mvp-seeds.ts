/** Finite, persisted MVP seed reserve. No daily replenishment. */
export interface MvpSeeds {
 version:1; adoptedAt:number; initial:8; stock:number;
 claimed:Record<string,number>; saved:Record<string,number>;
}
export type MvpSeedAction={type:'mvpCollectSeed'}|{type:'mvpSaveSeed'};
