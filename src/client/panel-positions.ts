import {captureArchivePosition,restoreArchivePosition,type ArchivePosition} from './archive-position.js';

export interface PanelView {key:string;revision:number;}
interface SavedPosition {view:PanelView;position:ArchivePosition;}
const same=(a:PanelView|undefined,b:PanelView)=>a?.key===b.key&&a.revision===b.revision;

/** In-memory return positions. Replaced worlds, queries and page sets never reuse old scroll. */
export class PanelPositions {
 private saved=new Map<string,SavedPosition>();private current?:PanelView;
 private pending?:SavedPosition&{appliedScroll:number};
 save(root:HTMLElement){
  if(!this.current)return;this.scrolled(root);
  const position=this.pending&&same(this.pending.view,this.current)?this.pending.position:captureArchivePosition(root);
  this.saved.delete(this.current.key);this.saved.set(this.current.key,{view:{...this.current},position});
  while(this.saved.size>40)this.saved.delete(this.saved.keys().next().value!);
 }
 restore(root:HTMLElement,view:PanelView,options:{entry:boolean;keep:boolean;ready:boolean},redraw:ArchivePosition){
  if(this.pending&&redraw.scroll!==this.pending.appliedScroll)this.pending=undefined;
  let position:ArchivePosition|undefined;
  if(options.entry){const saved=this.saved.get(view.key);if(saved&&same(saved.view,view))position=saved.position;}
  else if(options.keep&&same(this.current,view))position=this.pending?.position??redraw;
  this.current={...view};this.pending=undefined;
  if(position){restoreArchivePosition(root,position);if(!options.ready)this.pending={view:{...view},position,appliedScroll:root.scrollTop};}
  else root.scrollTop=0;
 }
 // Programmatic restoration can emit scroll too. Only a different actual position cancels a pending return.
 scrolled(root:HTMLElement){if(this.pending&&root.scrollTop!==this.pending.appliedScroll)this.pending=undefined;}
 interacted(){this.pending=undefined;}
 deactivate(){this.current=undefined;this.pending=undefined;}
 clear(){this.saved.clear();this.deactivate();}
}
