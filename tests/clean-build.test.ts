import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,symlinkSync,linkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {cleanBuild} from '../scripts/clean-build.mjs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
function fixture(t:{after:(f:()=>void)=>void}){const root=mkdtempSync(join(testTmpdir(),'clean-build-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('clean build removes only generated JS/maps, keeps source, output and saves',t=>{
 const root=fixture(t);mkdirSync(join(root,'build/server'),{recursive:true});mkdirSync(join(root,'runtime'));mkdirSync(join(root,'output'));
 for(const path of ['build/server/main.js','build/server/main.js.map','runtime/world.sqlite','output/evidence.txt','.env','package.json'])writeFileSync(join(root,path),'synthetic');
 cleanBuild(root);assert.equal(existsSync(join(root,'build')),false);
 for(const path of ['runtime/world.sqlite','output/evidence.txt','.env','package.json'])assert.equal(readFileSync(join(root,path),'utf8'),'synthetic');
 cleanBuild(root);
});
test('clean build rejects unexpected files or links before any deletion',t=>{
 const root=fixture(t),outside=fixture(t);mkdirSync(join(root,'build/server'),{recursive:true});
 const safe=join(root,'build/server/first.js');writeFileSync(safe,'generated');
 const unexpected=join(root,'build/server/world.sqlite');writeFileSync(unexpected,'synthetic');assert.throws(()=>cleanBuild(root),/unexpected_build_file/);assert.ok(existsSync(safe));rmSync(unexpected);
 writeFileSync(join(outside,'victim.js'),'preserve');symlinkSync(join(outside,'victim.js'),join(root,'build/server/link.js'));assert.throws(()=>cleanBuild(root),/unsafe_build_symlink/);assert.ok(existsSync(safe));rmSync(join(root,'build/server/link.js'));
 linkSync(join(outside,'victim.js'),join(root,'build/server/hard.js'));assert.throws(()=>cleanBuild(root),/unexpected_build_file/);assert.ok(existsSync(safe));rmSync(join(root,'build/server/hard.js'));
 rmSync(join(root,'build'),{recursive:true});symlinkSync(outside,join(root,'build'),'dir');assert.throws(()=>cleanBuild(root),/unsafe_build_directory/);assert.equal(readFileSync(join(outside,'victim.js'),'utf8'),'preserve');
 const alias=join(outside,'alias');symlinkSync(root,alias,'dir');assert.throws(()=>cleanBuild(alias),/unsafe_build_directory/);
});
