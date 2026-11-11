export interface ArchivePosition {scroll:number;eventId?:string;offset:number;waterOpen:string[];}
/** Store only values, not old DOM nodes, so a position can survive leaving the view. */
export function captureArchivePosition(root:HTMLElement):ArchivePosition {
 const records=[...root.querySelectorAll<HTMLElement>('[data-history-event]')];
 const bounds=records.length?root.getBoundingClientRect():undefined,top=bounds?.top??0;
 const anchor=records.find(record=>{const rect=record.getBoundingClientRect();return rect.bottom>top&&rect.top<bounds!.bottom;});
 return {scroll:root.scrollTop,eventId:anchor?.dataset.historyEvent,offset:anchor?anchor.getBoundingClientRect().top-top:0,
  waterOpen:[...root.querySelectorAll<HTMLDetailsElement>('details[data-water-event]')].filter(detail=>detail.open).map(detail=>detail.dataset.waterEvent!)};
}
export function restoreArchivePosition(root:HTMLElement,position:ArchivePosition){
 for(const detail of root.querySelectorAll<HTMLDetailsElement>('details[data-water-event]'))detail.open=position.waterOpen.includes(detail.dataset.waterEvent!);
 root.scrollTop=position.scroll;
 if(!position.eventId)return;
 const record=[...root.querySelectorAll<HTMLElement>('[data-history-event]')].find(record=>record.dataset.historyEvent===position.eventId);
 if(record)root.scrollTop+=record.getBoundingClientRect().top-root.getBoundingClientRect().top-position.offset;
}
/** Restore the same visible record after an observer-only redraw, with pixels as a fallback. */
export function rememberArchivePosition(root:HTMLElement){const position=captureArchivePosition(root);return ()=>restoreArchivePosition(root,position);}
