import {DatabaseSync} from 'node:sqlite';
import {acquireDeveloperMvpSpiritFixtureOwner,isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';
import {createValleySpiritAlmanacPacket,MAX_ALMANAC_WEATHER_SOURCES,type ValleySpiritAlmanacAuthority,type ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import {readExistingPublicWeatherJournal,type PublicWeatherEntry} from './valley-spirit.js';
import {verifyNativeWeatherCreditBatch} from './valley-spirit-weather-credit.js';

/** Private, sealed developer packet witness only. No model account permission,
 * transport, edition prerequisite, durable writes, or life/private content. */
export function openPrivateNativeWeatherPacketReader(fixture:DeveloperMvpSpiritFixtureKey,worldId:string){
 if(typeof worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(worldId))throw Error('native_weather_packet_world_invalid');
 const owner=acquireDeveloperMvpSpiritFixtureOwner(fixture);
 try{
  const reader=openPrivateNativeWeatherPacketReaderOnOwner(owner,worldId);
  return Object.freeze({packet:reader.packet,close(){try{reader.close();}finally{owner.release();}}});
 }catch(e){owner.release();throw e;}
}
/** Internal companion reader. Borrows only the genuine branded owner. */
export function openPrivateNativeWeatherPacketReaderOnOwner(owner:DeveloperMvpSpiritFixtureOwner,worldId:string){
 if(typeof worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(worldId)||!isDeveloperMvpSpiritFixtureOwner(owner))
  throw Error('native_weather_packet_owner_invalid');
 owner.assertOwned();
 let db:DatabaseSync|undefined;
 try{
  if(owner.formalApprovalKeyPem||owner.formalShadowKeyPem)throw Error('native_weather_packet_invalid_owner');
  const sqlite=db=new DatabaseSync(owner.database,{readOnly:true});
  sqlite.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  let closed=false,isolated=false;
  let priorRevision=-1,priorTime=-1n,priorEpoch=0,priorEntries:PublicWeatherEntry[]=[];
  const authority:ValleySpiritAlmanacAuthority={
   permission:()=>null,resolve:()=>null, // no fallback to uncoupled reads
   readCurrent(refs){
    if(closed||isolated||refs.length<1||refs.length>MAX_ALMANAC_WEATHER_SOURCES)return null;
    let transaction=false;
    try{
     owner.assertOwned();
     sqlite.exec('BEGIN');transaction=true;
     const seal=sqlite.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
     if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal)
      throw Error('native_weather_packet_seal_changed');
     const head=readNativeValidationWeatherHead(sqlite,worldId);
     const grant=readValleySpiritWeatherPermission(sqlite,worldId);
     let batch:ReturnType<NonNullable<ValleySpiritAlmanacAuthority['readCurrent']>>=null;
     if(head&&grant){
      if(head.worldRevision<priorRevision||BigInt(head.atUs)<priorTime||grant.version<priorEpoch)
       throw Error('rewound_native_weather_packet_head');
      priorRevision=head.worldRevision;priorTime=BigInt(head.atUs);priorEpoch=grant.version;
      const candidate=readExistingPublicWeatherJournal(owner.database,head,grant);
      if(candidate){
       if(candidate.entries.length<priorEntries.length||priorEntries.some((e,i)=>JSON.stringify(e)!==JSON.stringify(candidate.entries[i])))
        throw Error('rewound_native_weather_packet_archive');
       const requested=new Set(refs);
       const found=new Map(candidate.entries.filter(e=>e.permissionVersion===grant.version&&requested.has(e.sourceRef)).map(e=>[e.sourceRef,e]));
       const ordered=refs.map(ref=>found.get(ref));
       if(ordered.every((e):e is PublicWeatherEntry=>!!e)&&verifyNativeWeatherCreditBatch(sqlite,worldId,ordered)){
        priorEntries=candidate.entries;
        batch={worldId,permissionVersion:grant.version,records:ordered};
       }
      }
     }
     owner.assertOwned();
     sqlite.exec('COMMIT');transaction=false;
     return batch;
    }catch{
     isolated=true;
     if(transaction)try{sqlite.exec('ROLLBACK');}catch{/* handle stays isolated */}
     return null;
    }
   }
  };
  return Object.freeze({
   /** Only the canonical allowlisted packet escapes this reader. */
   packet(range:Omit<ValleySpiritAlmanacRange,'worldId'>){
    const p=createValleySpiritAlmanacPacket({...range,worldId},authority);
    if(!p)return null;
    for(const point of p.points)Object.freeze(point);
    Object.freeze(p.points);Object.freeze(p.unselectedHourBuckets);
    return Object.freeze(p);
   },
   close(){
    if(closed)return;closed=true;
    sqlite.close();
   }
  });
 }catch(e){db?.close();throw e;}
}
