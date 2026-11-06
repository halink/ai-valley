import {crateLocation} from '../world/livestock-cargo.js';
import type {Boat} from '../shared/ferry.js';
import {estatePiles} from './estate-custody.js';
import type {CultureEvent} from '../shared/culture.js';
import type {HouseholdPool} from '../shared/household.js';
import type {InfrastructureAsset} from '../shared/infrastructure.js';
import type {ForeignShipment} from '../shared/foreign-trade.js';
import type {Livestock} from '../shared/industry.js';
import type {WildBeast} from '../shared/frontier-hazards.js';
import type {EcologySelection} from './animal-observation.js';
import type {OrchardTree} from '../shared/industry.js';
import Phaser from 'phaser';
import type {ConstructionProject} from '../shared/construction.js';
import {constructionArt} from './construction-art.js';
import type { Building, Grave, Plot, Resource, Season, World } from '../shared/types.js';
import * as Art from './art.js';
import {materials} from './palette.js';

const CHUNK = 32;
const PIXELS = CHUNK * Art.TILE;
const chunkId = (x: number, y: number) => y * 65536 + x;
type Picture = Phaser.GameObjects.Image;
type Prop =
  | {kind:'beast';record:{id:string;at:{x:number;y:number};species:WildBeast['species'];alert:boolean}}
  | {kind:'fish';record:{id:string;at:{x:number;y:number};amount:number;feeding:boolean}}
  | {kind:'pasture';record:{id:string;at:{x:number;y:number};edge:number;grazed:boolean}}
  | {kind:'shore';record:{id:string;at:{x:number;y:number}}}
  | {kind:'ferry';record:Boat}
  | {kind:'crate';record:{id:string;at:{x:number;y:number}}}
  | {kind:'estate';record:{id:string;at:{x:number;y:number}}}
  | {kind:'culture';record:CultureEvent}
  | {kind:'household';record:HouseholdPool}
  | {kind:'cargo';record:ForeignShipment & {at:{x:number;y:number}}}
  | {kind:'infrastructure';record:InfrastructureAsset}
  | {kind:'animal';record:Livestock & {at:{x:number;y:number}}}
  | {kind:'orchard';record:OrchardTree}
  | {kind:'resource'; record: Resource}
  | {kind:'building'; record: Building}
  | {kind:'construction'; record: ConstructionProject}
  | {kind:'crop'; record: Plot}
  | {kind:'field'; record: Plot}
  | {kind:'post'; record: Plot}
  | {kind:'grave'; record: Grave};
type Range = {left:number;right:number;top:number;bottom:number};

function visibleChunks(camera: Phaser.Cameras.Scene2D.Camera, world: World): Range {
  const w = camera.width / camera.zoom, h = camera.height / camera.zoom;
  const cx = Phaser.Math.Clamp(camera.scrollX + camera.width / 2, 0, world.map.width * Art.TILE);
  const cy = Phaser.Math.Clamp(camera.scrollY + camera.height / 2, 0, world.map.height * Art.TILE);
  // A small margin covers oversized roofs, treetops and short drags.
  return {
    left: Math.max(0, Math.floor((cx - w / 2 - 96) / PIXELS)),
    right: Math.min(Math.ceil(world.map.width / CHUNK)-1, Math.floor((cx + w / 2 + 96) / PIXELS)),
    top: Math.max(0, Math.floor((cy - h / 2 - 112) / PIXELS)),
    bottom: Math.min(Math.ceil(world.map.height / CHUNK)-1, Math.floor((cy + h / 2 + 112) / PIXELS)),
  };
}

/** Live textures are bounded by the camera, even when crossing the valley end to end. */
export class Outdoors {
  private ground = new Map<number, Picture>();
  private props = new Map<string, Picture>();
  private textureKeys = new Set<string>();
  private buckets = new Map<number, Prop[]>();
  private world?: World;
  private season?: Season;
  private revision = '';
  private viewKey = '';
  private sceneryDirty = true;
  private visible = true;
  private pending: {x:number;y:number}[] = [];
  private day = -1;
  private fishFrame=0;

  constructor(private scene: Phaser.Scene) {}

  accept(world: World, season: Season, revision: string) {
    const old = this.world;
    if (old?.id !== world.id || this.revision !== revision || this.season !== season) {
      this.release();
      this.season = season;
      this.revision = revision;
    }
    const day = Math.floor(world.minute / 1440);
    if (!old || this.sceneryDirty || old.resources !== world.resources || old.buildings !== world.buildings ||
        old.estates !== world.estates || old.culture !== world.culture || old.household !== world.household || old.foreignTrade !== world.foreignTrade || old.infrastructure !== world.infrastructure || old.industry !== world.industry || old.frontierHazards!==world.frontierHazards || old.ferries !== world.ferries || !!world.industry?.livestockCargo?.some(c=>c.status==='crated')&&old.residents!==world.residents || old.construction !== world.construction || old.plots !== world.plots || old.graves !== world.graves || this.day !== day) {
      this.buckets.clear();
      const add = (prop:Prop) => {
        const {x,y} = prop.record.at;
        const id = chunkId(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
        const bucket = this.buckets.get(id);
        if (bucket) bucket.push(prop); else this.buckets.set(id,[prop]);
      };
      for (const record of world.resources) if (record.amount > 0 || record.kind !== 'rock') add({kind:'resource',record});
      for (const record of world.construction?.projects??[]) if(record.reserved) add({kind:'construction',record});
      for (const record of world.buildings) add({kind:'building',record});
      for (const [i,record] of world.plots.entries()) {
        add({kind:'field',record});
        if (record.crop) add({kind:'crop',record});
        if (i % 4 === 0) add({kind:'post',record});
      }
      for(const record of world.infrastructure?.assets??[])if(record.retiredAt===null&&(record.condition<25||['dock','cemetery'].includes(record.kind)))add({kind:'infrastructure',record});
      for(const record of estatePiles(world))if(!record.inside)add({kind:'estate',record});
      for(const record of world.culture?.events??[])if(record.preparation.completedAt!==null&&record.preparation.clearedAt===null)add({kind:'culture',record});
      for(const record of world.household?.pools??[])if(record.status==='open'||record.credits.some(c=>c.coins>0||Object.values(c.inventory).some(n=>n!>0)))add({kind:'household',record});
      for(const shipment of world.foreignTrade?.shipments??[])if(shipment.goods>0&&shipment.route?.at&&!['completed','cancelled'].includes(shipment.status))add({kind:'cargo',record:{...shipment,at:shipment.route.at}});
      for(const pasture of world.industry?.pastures??[]){
        const tiles=new Set(pasture.tiles.map(t=>`${t.x},${t.y}`));
        for(const at of pasture.tiles){
          const {x,y}=at;
          const edge=Number(!tiles.has(`${x},${y-1}`))+2*Number(!tiles.has(`${x+1},${y}`))+4*Number(!tiles.has(`${x},${y+1}`))+8*Number(!tiles.has(`${x-1},${y}`));
          add({kind:'pasture',record:{id:`${pasture.id}:${x},${y}`,at,edge,grazed:pasture.forage<pasture.capacity/3}});
        }
      }
      for(const b of world.frontierHazards?.beasts??[])if(b.status==='alive')add({kind:'beast',record:{id:b.id,at:b.at,species:b.species,alert:!!b.alert}});
      for(const [id,pool] of Object.entries(world.industry?.fishing??{}))if(pool.shoal&&pool.amount>0&&world.map.tiles[pool.shoal.at.y*world.map.width+pool.shoal.at.x]==='water'){
        add({kind:'fish',record:{id,at:pool.shoal.at,amount:pool.amount,feeding:pool.shoal.activity==='feeding'}});
      }
      if(world.industry?.frontierShore)add({kind:'shore',record:{id:'village-fishing-shore',at:world.industry.frontierShore}});
      for(const record of world.industry?.animals??[])if(record.status==='alive'&&record.at&&!record.inside)add({kind:'animal',record:record as Livestock & {at:{x:number;y:number}}});
      for(const record of world.industry?.trees??[])if(record.status!=='cut')add({kind:'orchard',record});
      const shown=new Set<string>();for(const c of world.industry?.livestockCargo??[])if(c.status==='crated'&&!shown.has(c.container)){const l=crateLocation(world,c);if(l?.at&&!l.inside){add({kind:'crate',record:{id:c.id,at:l.at}});shown.add(c.container);}}
      for(const record of world.ferries?.boats??[])add({kind:'ferry',record});
      for (const record of world.graves) add({kind:'grave',record});
      this.sceneryDirty = true;
    }
    this.world = world;
    this.day = day;
  }

  setVisible(value: boolean) {
    this.visible = value;
    for (const image of this.ground.values()) image.setVisible(value);
    for (const image of this.props.values()) image.setVisible(value);
  }

  private dropGround(id: number, image: Picture) {
    const key = image.texture.key;
    image.destroy();
    this.scene.textures.remove(key);
    this.ground.delete(id);
  }

  private release() {
    for (const [id,image] of this.ground) this.dropGround(id,image);
    for (const image of this.props.values()) image.destroy();
    this.props.clear();
    for (const key of this.textureKeys) this.scene.textures.remove(key);
    this.textureKeys.clear();
    this.viewKey = '';
    this.pending = [];
    this.sceneryDirty = true;
  }

  draw(camera: Phaser.Cameras.Scene2D.Camera,time:number) {
    const world = this.world;
    if (!world || !this.visible || !this.season) return;
    const bounds = visibleChunks(camera,world);
    const key = [bounds.left,bounds.right,bounds.top,bounds.bottom].join('/');
    if (key !== this.viewKey || this.sceneryDirty) {
      const visible = new Set<number>();
      const present = new Set<string>();
      const missing: {x:number;y:number}[] = [];
      for (let y = bounds.top; y <= bounds.bottom; y++) {
        for (let x = bounds.left; x <= bounds.right; x++) {
          const id = chunkId(x,y);
          visible.add(id);
          if (!this.ground.has(id)) missing.push({x,y});
          for (const prop of this.buckets.get(id) ?? []) this.place(prop, present);
        }
      }
      for (const [id,image] of this.ground) if (!visible.has(id)) this.dropGround(id,image);
      for (const [id,image] of this.props) if (!present.has(id)) { image.destroy(); this.props.delete(id); }
      const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
      const distance = (p:{x:number;y:number}) => Math.abs(p.x-cx)+Math.abs(p.y-cy);
      this.pending = missing.sort((a,b)=>distance(a)-distance(b));
      this.viewKey = key;
      this.sceneryDirty = false;
    }
    // Spend a bounded slice of each frame on new terrain; scrolling and controls remain responsive.
    const start = performance.now();
    while (this.pending.length && performance.now() - start < 7) {
      const {x,y} = this.pending.shift()!;
      const id = chunkId(x,y), key = 'land-'+id;
      this.scene.textures.addCanvas(key, Art.groundChunk(world,this.season,x*CHUNK,y*CHUNK,CHUNK));
      const picture = this.scene.add.image(x*PIXELS,y*PIXELS,key).setOrigin(0).setDepth(-1);
      this.ground.set(id,picture);
    }
    const fishFrame=Math.floor(time/450)%2;
    if(!world.clock.paused&&fishFrame!==this.fishFrame){
      this.fishFrame=fishFrame;
      for(const [id,image] of this.props)if(id.startsWith('fish/'))image.setTexture(image.getData('fishArt')[fishFrame]);
    }
  }

  subjectAt(x:number,y:number):EcologySelection|null {
    if(!this.visible)return null;
    let selection:EcologySelection|null=null,closest=Infinity;
    for(const [key,image] of this.props){
      const cut=key.indexOf('/'),kind=key.slice(0,cut);
      if(kind!=='fish'&&kind!=='beast'&&kind!=='animal')continue;
      const centerY=image.y-(kind==='fish'?10:12),gap=Math.hypot(x-image.x,y-centerY);
      if(gap<closest&&Math.abs(x-image.x)<image.width*.53&&Math.abs(y-centerY)<13){
        selection={kind,id:key.slice(cut+1)};closest=gap;
      }
    }
    return selection;
  }

  subjectPosition(selection:EcologySelection) {
    return this.props.get(selection.kind+'/'+selection.id);
  }

  private texture(key: string, make: ()=>HTMLCanvasElement) {
    if (!this.textureKeys.has(key)) {
      this.scene.textures.addCanvas(key, make());
      this.textureKeys.add(key);
    }
    return key;
  }

  private place(prop: Prop, present: Set<string>) {
    const {x,y}=prop.record.at, season=this.season!;
    let px=x*Art.TILE+8, py=y*Art.TILE+16, depth=py-1, ax=.5, ay=1, key:string,fishArt:string[]|undefined;
    switch (prop.kind) {
      case 'pasture':{const {edge,grazed}=prop.record;key=this.texture(`pasture-${edge}-${grazed}`,()=>Art.pastureTile(edge,grazed));px=x*Art.TILE;py=y*Art.TILE;ax=ay=0;depth=0;break;}
      case 'beast':{const {species,alert}=prop.record;key=this.texture(`beast-${species}-${alert}`,()=>Art.wildAnimal(species,alert));break;}
      case 'fish':{
        const count=Math.min(3,Math.ceil(prop.record.amount/4)),{feeding}=prop.record;
        fishArt=[0,1].map(frame=>this.texture(`shoal-${count}-${feeding}-${frame}`,()=>Art.fishShoal(count,frame,feeding)));
        key=fishArt[this.fishFrame];depth=1;py+=3;break;
      }
      case 'shore':{key=this.texture('shore-sign',()=>Art.fishingSign());depth-=1;break;}
      case 'culture':{key=this.texture('event-bunting-'+prop.record.kind,()=>Art.eventBunting(prop.record.kind));py-=25;depth+=1;break;}
      case 'estate':{key=this.texture('estate-sealed-chest',()=>Art.sharedChest());px-=6;break;}
      case 'household':{key=this.texture('shared-chest',()=>Art.sharedChest());px+=9;break;}
      case 'crate':{key=this.texture('livestock-crate',()=>Art.livestockCrate());px+=10;depth+=1;break;}
      case 'ferry':{key=this.texture('ferry-'+(prop.record.condition<25),()=>Art.ferryBoat(prop.record.condition<25));depth-=2;break;}
      case 'cargo':{key=this.texture('cargo-cart',()=>Art.cargoCart());px+=5;break;}
      case 'infrastructure':{const a=prop.record,closed=a.condition<=0;key=this.texture('public-work-'+a.kind+'-'+closed,()=>Art.publicWorkSign(a.kind,closed));px=a.access.x*16+8;py=a.access.y*16+16;depth=py;break;}
      case 'animal':{key=this.texture('animal-'+prop.record.kind,()=>Art.animal(prop.record.kind));px+=7;break;}
      case 'orchard':{const t=prop.record;key=this.texture('orchard-'+t.status+'-'+(t.fruit>0),()=>Art.orchard(season,t.status==='mature',t.fruit>0));break;}
      case 'resource': {
        const r=prop.record;
        if (r.kind==='tree') {
          const stump = r.amount<=0;
          const variant = stump ? 0 : Math.min(2,Math.floor(Art.hash(x,y)*3));
          key=this.texture(stump?'stump':'tree-'+variant,()=>Art.tree(season,variant,stump));
        } else {
          const available = r.kind!=='bush'||r.amount>0;
          key=this.texture('resource-'+r.kind+(available?'':'-empty'),()=>Art.resource(r.kind,season,available));
        }
        break;
      }
      case 'construction': {
        const p=prop.record,phase=p.stages.filter(s=>s.startedAt!==null).length;
        key=this.texture(['site',p.width,p.height,p.mode,p.base?p.base.at.x-p.at.x:0,p.base?p.base.at.y-p.at.y:0,p.base?.width,p.base?.height,phase].join('-'),()=>constructionArt(p));
        px=x*Art.TILE;py=y*Art.TILE-24;depth=p.base?(p.base.at.y+p.base.height)*Art.TILE-2:(y+p.height)*Art.TILE-1;ax=ay=0;break;
      }
      case 'building': {
        const b=prop.record;
        key=this.texture(['building',b.id,b.definition,b.width,b.height,b.door.x-x].join('-'),()=>Art.house(b,season,this.world?.definitions[b.definition]?.data.art));
        px=x*Art.TILE-4; py=y*Art.TILE-4; depth=(y+b.height)*Art.TILE-1; ax=ay=0;
        break;
      }
      case 'field': {
        const wet=prop.record.crop?.wateredDay===this.day;
        key=this.texture('farm-soil-'+wet,()=>Art.farmSoil(wet));
        px=x*Art.TILE;py=y*Art.TILE;depth=0;ax=ay=0;break;
      }
      case 'crop': {
        const crop=prop.record.crop!;
        const duration=Number(this.world!.definitions[crop.definition]?.data.growthDays??4);
        const output=String(this.world!.definitions[crop.definition]?.data.output??'turnip');
        const progress=crop.growth/duration, wet=crop.wateredDay===this.day;
        key=this.texture('crop-'+output+'-'+Math.min(3,Math.floor(progress*3))+'-'+wet,()=>Art.crop(progress,wet,output));
        px=x*Art.TILE; py=y*Art.TILE-4; ax=ay=0;
        break;
      }
      case 'post': {
        key=this.texture('plot-post',()=>{
          const c=document.createElement('canvas');c.width=2;c.height=7;
          const ctx=c.getContext('2d')!;ctx.fillStyle=materials.postDark;ctx.fillRect(0,0,2,7);
          ctx.fillStyle=materials.postLight;ctx.fillRect(0,0,2,1);return c;
        });
        px=x*Art.TILE-3; py=y*Art.TILE+8; depth=2; ax=ay=0;
        break;
      }
      case 'grave': {
        const occupied=Boolean(prop.record.personId);
        const worn=Math.floor((prop.record.condition??100)/25);
        key=this.texture(occupied?'grave-full-'+worn:'grave-empty',()=>Art.grave(occupied,prop.record.condition??100));
        break;
      }
    }
    const id=prop.kind+'/'+prop.record.id;
    present.add(id);
    let image=this.props.get(id);
    if (!image) {image=this.scene.add.image(px,py,key);this.props.set(id,image);}
    if (image.texture.key!==key) image.setTexture(key);
    if(fishArt)image.setData('fishArt',fishArt);
    const movable=prop.kind==='animal'||prop.kind==='beast'||prop.kind==='fish';
    if(!movable||this.world!.clock.paused){if(movable)this.scene.tweens.killTweensOf(image);image.setPosition(px,py);}
    else if(image.getData('targetX')!==px||image.getData('targetY')!==py){
      this.scene.tweens.killTweensOf(image);
      if(Math.hypot(image.x-px,image.y-py)>48)image.setPosition(px,py);
      else if(image.x!==px||image.y!==py)this.scene.tweens.add({targets:image,x:px,y:py,duration:650,ease:'Linear'});
    }
    if(movable){image.setData('targetX',px);image.setData('targetY',py);}
    image.setDepth(depth).setOrigin(ax,ay);
  }
}
