/** One shared load, with explicit retry after failure rather than a snapshot-driven retry loop. */
export class LazyModule<T> {
 value:T|null=null;
 status:'idle'|'loading'|'ready'|'error'='idle';
 private pending:Promise<void>|null=null;
 constructor(private readonly load:()=>Promise<T>,private readonly changed:()=>void){}
 request(retry=false):Promise<void>{
  if(this.pending)return this.pending;
  if(this.status==='ready'||this.status==='error'&&!retry)return Promise.resolve();
  this.status='loading';
  this.pending=Promise.resolve().then(this.load).then(value=>{
   this.value=value;this.status='ready';
  },()=>{this.status='error';}).then(()=>{
   this.pending=null;this.changed();
  });
  return this.pending;
 }
}
