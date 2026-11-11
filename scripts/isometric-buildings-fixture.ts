/** Synthetic records only. No save, model, server, browser or IPC is opened. */
import {isometricStudyFixture} from './isometric-study-fixture.js';
import type {Building,BuildingKind,Resource,Season,Snapshot,Tile} from '../src/shared/types.js';
import type {ConstructionProject} from '../src/shared/construction.js';
import type {OrchardTree} from '../src/shared/industry.js';
import {buildingMarks,buildingLabel,buildingFootprint,constructionMarks,constructionLabel} from '../src/client/isometric-buildings.js';
import {resourceMarks,resourceLabel,orchardMarks,orchardLabel} from '../src/client/isometric-resources.js';
import {terrain,type StudyObject,type IsometricStudy} from '../src/client/isometric-study.js';
import {orderIsometricObjects} from '../src/client/isometric-projection.js';
export const fixtureBuildingKinds:BuildingKind[]=['home','lodge','workshop','clinic','school','barn','greenhouse','store'];
export function syntheticBuilding(kind:BuildingKind,at={x:3,y:3}):Building {
 return {id:'synthetic-building-'+kind,kind,name:'合成'+kind,at,width:3,height:2,door:{x:at.x+1,y:at.y+2},ownerId:'commons',definition:'building/'+kind+'@1',capacity:1,residents:[],condition:100};
}
export function syntheticConstruction(phase:number,at={x:2,y:25}):ConstructionProject {
 return {id:'synthetic-project-'+phase,name:'合成新建工程'+phase,mode:'new',ownerId:'commons',managerId:'synthetic-owner',kind:'workshop',definition:'building/workshop@1',ruleVersion:1,at,width:3,height:2,door:{x:at.x+1,y:at.y+2},base:null,capacity:1,buildingId:null,boardId:null,createdAt:0,updatedAt:720,finishedAt:null,authorizedUntil:null,status:phase?'active':'planned',reserved:true,reason:null,
 stages:[0,1,2].map(i=>({name:['基础与地基','梁柱与墙体','屋顶与交付'][i],materials:{wood:2,stone:1},minutes:60,worked:i<phase-1?60:i===phase-1?30:0,startedAt:i<phase?10+i*60:null,finishedAt:i<phase-1?70+i*60:null})),stage:Math.max(0,phase-1),incorporated:{wood:phase*2,stone:phase},stock:[],claims:[],grants:[],account:'synthetic-escrow',wagePerHour:0,prices:{},spentWages:0,spentSupplies:0,applications:[],workers:[],nextWorker:0,labor:[],demolitionMinutes:0,lastDemolitionAt:null};
}
export function syntheticOrchard(status:'growing'|'mature'='mature',fruit=0,at={x:3,y:20}):OrchardTree {
 return {id:'synthetic-orchard-'+status+'-'+fruit,ownerId:'synthetic-owner',plotId:'synthetic-plot',at,plantedAt:0,growth:status==='growing'?100:50000,lastWateredDay:0,lastMinute:720,fruit,fruitProgress:0,status};
}
export function syntheticResource(kind:'rock'|'bush'|'spring',amount=12,at={x:12,y:15}):Resource {
 return {id:'synthetic-resource-'+kind+'-'+amount,kind,at,amount,max:12,regrowthDays:10,lastHarvest:0};
}
export function isometricBuildingsFixture(){
 const {world}=isometricStudyFixture();world.id='synthetic-building-resource-art';world.minute=720;world.map={width:32,height:30,tiles:Array<Tile>(960).fill('grass'),name:'合成建筑资源样板',entrance:{x:0,y:12}};
 for(let y=0;y<30;y++)for(let x=0;x<32;x++)if(y===12||y===18||y===23)world.map.tiles[y*32+x]='path';
 world.residents=[];world.plots=[];world.graves=[];world.estates=[];world.infrastructure=undefined;world.culture=undefined;world.household=undefined;world.foreignTrade=undefined;world.ferries=undefined;world.frontierHazards=undefined;
 world.buildings=fixtureBuildingKinds.map((kind,i)=>syntheticBuilding(kind,{x:2+i%4*7,y:2+Math.floor(i/4)*6}));
 world.buildings.push({...syntheticBuilding('clinic',{x:2,y:14}),id:'synthetic-damaged-clinic',condition:15},{...syntheticBuilding('home',{x:7,y:14}),id:'synthetic-zero-home',condition:0});
 world.resources=(['rock','bush','spring'] as const).flatMap((kind,i)=>[syntheticResource(kind,12,{x:13+i*6,y:14}),syntheticResource(kind,0,{x:15+i*6,y:16})]);
 const trees=[syntheticOrchard('growing',0,{x:3,y:20}),syntheticOrchard('mature',0,{x:8,y:20}),syntheticOrchard('mature',7,{x:13,y:20})];
 world.industry={trees,tools:[],animals:[],fishing:{},stations:[],batches:[],mines:[],beds:[],nextSerial:1} as unknown as NonNullable<typeof world.industry>;
 const projects=[0,1,2,3].map((phase)=>syntheticConstruction(phase,{x:2+phase*7,y:25}));
 world.construction={projects,nextSerial:5,yards:{},knownProjects:{},totals:{completed:0,expanded:0,labor:0,wages:0,procurement:0,demolished:0}};
 const snapshot:Snapshot={world,serverTime:'synthetic-offline',version:'synthetic-building-art',capabilities:{active:[],pending:[]}};
 return {world,snapshot};
}
/** This diagnostic calls the same pure mark functions. Viewport integration is a separate test. */
export function buildingFixtureScene(season:Season='spring'):IsometricStudy {
 const {world}=isometricBuildingsFixture(),objects:StudyObject[]=[];
 for(const b of world.buildings){const marks=buildingMarks(b,season,world.definitions[b.definition]?.data.art);if(!marks)throw new Error('unsupported_synthetic_building');objects.push({key:'building:'+b.id,subject:{kind:'building',id:b.id,at:{...b.at},description:buildingLabel(b)},footprint:buildingFootprint(b)!,marks});}
 for(const r of world.resources){const marks=resourceMarks(r,season);if(!marks)throw new Error('unsupported_synthetic_resource');objects.push({key:'resource:'+r.id,subject:{kind:'resource',id:r.id,at:{...r.at},description:resourceLabel(r)},footprint:{...r.at,width:1,height:1},marks});}
 for(const t of world.industry!.trees){const marks=orchardMarks(t,season);if(!marks)throw new Error('unsupported_synthetic_orchard');objects.push({key:'orchard:'+t.id,subject:{kind:'orchard',id:t.id,at:{...t.at},description:orchardLabel(t)},footprint:{...t.at,width:1,height:1},marks});}
 for(const p of world.construction!.projects){const marks=constructionMarks(p,world.minute);if(!marks)throw new Error('unsupported_synthetic_project');objects.push({key:'project:'+p.id,subject:{kind:'project',id:p.id,at:{...p.at},description:constructionLabel(p,world.minute)},footprint:buildingFootprint(p)!,marks});}
 const bounds={x:0,y:0,width:32,height:30};
 return {width:1056,height:600,camera:{origin:{x:504,y:70},zoom:1},bounds,terrain:terrain(world,bounds,season,{cutEdges:false}),objects:orderIsometricObjects(objects)};
}
