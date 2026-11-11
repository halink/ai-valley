/** Fresh synthetic snapshot for living-art tests. Never opens or advances a save/model. */
import {isometricStudyFixture} from './isometric-study-fixture.js';
import type {Livestock,FishPool} from '../src/shared/industry.js';
import type {WildBeast} from '../src/shared/frontier-hazards.js';
import {beastNames} from '../src/shared/frontier-hazards.js';
import {fishSpecies,type FishSpecies} from '../src/shared/fish-species.js';
import type {Snapshot,Tile} from '../src/shared/types.js';
export function isometricLivingFixture(){
 const {world}=isometricStudyFixture();world.id='synthetic-living-art';world.minute=720;world.map={width:26,height:20,tiles:Array<Tile>(520).fill('grass'),name:'合成生灵画面',entrance:{x:0,y:8}};
 for(let y=0;y<20;y++)for(let x=0;x<26;x++)world.map.tiles[y*26+x]=x>=19?'water':y===8||x===10?'path':'grass';
 world.residents=[];world.plots=[];world.resources=world.resources.slice(0,3);world.buildings[0].at={x:10,y:1};world.buildings[0].door={x:11,y:3};
 world.estates=[];world.infrastructure=undefined;world.culture=undefined;world.household=undefined;world.foreignTrade=undefined;world.ferries=undefined;world.construction=undefined;
 const animals:Livestock[]=(['chicken','goat','sheep','duck','cow'] as const).map((kind,i)=>({id:'synthetic-livestock-'+kind,ownerId:'synthetic-owner',kind,sex:'female',bornAt:0,barnId:'synthetic-barn',at:{x:11+i%3*3,y:6+Math.floor(i/3)*4},inside:null,hunger:20,thirst:20,health:90,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:720,activity:{kind:i===2?'rest':'roam',reason:'合成姿态样例',target:{x:12+i%3*3,y:6+Math.floor(i/3)*4}}}));
 const beasts:WildBeast[]=Object.keys(beastNames).map((species,i)=>({id:'synthetic-wild-'+species,species:species as WildBeast['species'],at:{x:3+i%3*3,y:5+Math.floor(i/3)*5},den:{x:1,y:1},nextMoveAt:0,cooldownUntil:0,health:90,hunger:20,bornAt:0,status:'alive',activity:{kind:'roam',reason:'合成姿态样例',target:{x:4+i%3*3,y:5+Math.floor(i/3)*5}}}));
 const stock=(amount:number)=>({amount,progress:0,opening:amount,born:0,caught:0,eaten:0,arrived:0,departed:0});
 const pool=(species:FishSpecies[],x:number,y:number):FishPool=>({amount:species.length*2,progress:0,lastMinute:720,species:Object.fromEntries(species.map(kind=>[kind,stock(2)])),shoal:{anchor:{x,y},at:{x,y},nextMoveAt:800,activity:'feeding'}});
 const fishing:Record<string,FishPool>={};fishSpecies.forEach((kind,i)=>fishing['synthetic-pool-'+kind]=pool([kind],21+i%2*3,2+Math.floor(i/2)*3));
 fishing['synthetic-pool-mixed']=pool(fishSpecies,22,15);
 world.industry={trees:[],tools:[],animals,fishing,stations:[],batches:[],mines:[],greenhouse:[],nextSerial:1} as unknown as NonNullable<typeof world.industry>;
 world.frontierHazards={beasts,disasters:[],foodPatches:[]} as unknown as NonNullable<typeof world.frontierHazards>;
 world.graves=[{id:'synthetic-empty',at:{x:4,y:15},personId:null,buriedAt:null},{id:'synthetic-reserved',at:{x:7,y:15},personId:null,reservedBy:'synthetic-owner',buriedAt:null},{id:'synthetic-assigned',at:{x:10,y:15},personId:'synthetic-unburied',buriedAt:null},{id:'synthetic-buried',at:{x:13,y:15},personId:'synthetic-deceased',buriedAt:0,condition:90}];
 const snapshot:Snapshot={world,serverTime:'synthetic-offline',version:'synthetic-living-art',capabilities:{active:[],pending:[]}};
 return {world,snapshot};
}
