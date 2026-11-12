import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storybookProductionImportViolations as violations,forbiddenStorybookProductionModules as forbidden,productionStorybookModules,forbiddenStorybookProductionAssets} from './helpers/storybook-production-boundary.js';
test('formal UI exact imports are allowed only where explicitly authorized',()=>{
 for(const extension of ['js','css']){
  const source=`import './storybook-ui-shell.${extension}';`;
  assert.deepEqual(violations(source,true),[]);assert.equal(violations(source).length,1);
 }
 assert.deepEqual(violations("import {mountStorybookUIShell as present} from './storybook-ui-shell.js'; import('./panel-renderers.js');",true),[]);
 assert.deepEqual(violations("// import './storybook-development-entry.js'",true),[]);
 assert.ok(violations("const asset='./storybook-development-entry.js';",true).length);
});
test('development previews and animation wiring cannot bypass the boundary through module syntax or names',()=>{
 const modules=['storybook-development-entry','storybook-development-preview','storybook-development-session','storybook-animated-observer','storybook-animation-phaser','storybook-render-plan','storybook-synthetic-atlas','storybook-phaser','storybook-geometry','storybook-new-unknown','storybook-ui-entry','storybook-ui-shell-copy'];
 for(const module of modules)for(const source of [
  `import {x as alias} from './${module}.js';`, `import './${module}.js';`,
  `export * from './${module}.js';`, `export {x} from './${module}.js';`,
  `import('./${module}.js')`, 'import(`./'+module+'.js`)',
  `require('./${module}.js')`, `import x = require('./${module}.js');`,
 ])assert.ok(violations(source,true).length,source);
 for(const source of ["import('./story'+'book-development-entry.js')","const p='./storybook-development-entry.js'; import(p);",String.raw`import './story\u0062ook-development-entry.js';`,"import './storybook-ui-shell.js?raw';","import '../client/storybook-ui-shell.js';","import './storybook-ui-shell.js/evil';","import './storybook-ui-shell.ts';","new URL('./storybook-development-entry.ts',import.meta.url);","new Worker(new URL('./storybook-development-entry.ts',import.meta.url));","new URL('./story'+'book-development-entry.ts',import.meta.url);","const asset = `./storybook-${kind}.ts`;","if(false)import('./storybook-development-entry.js');","import type {X} from './storybook-development-entry.js';","type X = import('./storybook-development-entry.js').X;"])
  assert.ok(violations(source,true).length,source);
});
test('complete production graph rejects indirect/lazy modules, virtual suffixes and fake UI-prefix names',()=>{
 const allowed=[...productionStorybookModules,'/repo/src/client/main.ts'];
 assert.deepEqual(forbidden(allowed),[]);
 assert.deepEqual(forbiddenStorybookProductionAssets(['assets/index-123.js','assets/storybook-development-entry-123.ts']),['assets/storybook-development-entry-123.ts']);
 for(const id of ['/repo/src/client/storybook-development-entry.ts','/repo/src/client/storybook-animated-observer.ts','/repo/src/client/storybook-ui-shell.ts?raw','/repo/src/client/storybook-ui-shell-copy.ts','/repo/scripts/storybook-ui-shell.ts','/another-project/src/client/storybook-ui-shell.ts'])assert.deepEqual(forbidden([...allowed,id]),[id]);
});
