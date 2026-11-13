import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=(file:string)=>readFileSync(new URL(file,root),'utf8');
test('the active product has one browser client and no retired Phaser or desktop launch entry',()=>{
 const pkg=JSON.parse(read('package.json'));
 for(const name of ['phaser','vite']) assert.equal(pkg.dependencies?.[name]??pkg.devDependencies?.[name],undefined);
 for(const file of ['src/client','src/tools','assets/storybook','index.html','storybook-slice.html','vite.config.ts','scripts/demo-godot.mjs','src/server/main.ts','src/server/self-hosted-main.ts','src/server/preview-main.ts','src/server/godot-mvp-main.ts']) assert.equal(existsSync(new URL(file,root)),false,file);
 assert.equal(pkg.scripts.dev,'node --import tsx src/server/godot-web-main.ts');
 assert.equal(pkg.scripts.start,'node build/server/godot-web-main.js');
 assert.equal(pkg.scripts['demo:godot'],undefined);
 assert.ok(pkg.scripts['build:godot:web']);
 assert.match(read('godot-client/export_presets.cfg'),/platform="Web"/);
 assert.doesNotMatch(read('godot-client/export_presets.cfg'),/platform="(?:Linux|Windows|macOS)/);
});
