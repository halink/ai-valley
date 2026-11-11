import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'vite';

test('production loading graph keeps optional renderers out of all initial chunks and HTML preloads',async()=>{
 const result=await build({configFile:false,envFile:false,base:'/ai-town/',logLevel:'silent',build:{write:false}});
 assert.ok(!Array.isArray(result));assert.ok('output' in result);
 const chunks=result.output.filter(output=>output.type==='chunk');
 const entry=chunks.find(chunk=>chunk.isEntry)!;assert.ok(entry);
 const initial=new Set<string>();
 const visit=(name:string)=>{if(initial.has(name))return;initial.add(name);for(const dependency of chunks.find(c=>c.fileName===name)?.imports??[])visit(dependency);};
 visit(entry.fileName);
 const initialModules=chunks.filter(c=>initial.has(c.fileName)).flatMap(c=>Object.keys(c.modules));
 assert.ok(initialModules.some(id=>id.endsWith('/phaser/dist/phaser.js')),'map engine remains immediately available');
 const deferred=chunks.find(c=>Object.keys(c.modules).some(id=>id.endsWith('/src/client/panel-renderers.ts')))!;
 assert.ok(deferred);assert.ok(entry.dynamicImports.includes(deferred.fileName));assert.ok(!initial.has(deferred.fileName));
 for(const module of ['livelihood','wilderness','commerce','health','food-observation']){
  assert.ok(!initialModules.some(id=>id.endsWith(`/src/client/${module}.ts`)),`${module} must not return to the initial graph`);
  assert.ok(Object.keys(deferred.modules).some(id=>id.endsWith(`/src/client/${module}.ts`)),`${module} is included on demand`);
 }
 assert.ok(Buffer.byteLength(deferred.code)>50_000,'defer a meaningful amount of code, not just an entry wrapper');
 const html=result.output.find(output=>output.type==='asset'&&output.fileName==='index.html');assert.ok(html?.type==='asset');
 assert.ok(!String(html.source).includes(deferred.fileName),'no eager HTML preload of optional panels');
});
