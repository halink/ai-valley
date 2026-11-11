// Produces only explicitly labeled SYNTHETIC input in a new repository-owned output directory.
import {mkdtempSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {testTmpdir} from './repository-temporary.mjs';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.ts';
if (process.argv.length !== 2) throw Error('This fixture generator takes no input images or arguments.');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(testTmpdir(), 'storybook-assets-synthetic-'));
const fixture = createSyntheticStorybookInput();
writeFileSync(join(directory, 'recipe.json'), fixture.recipeBytes, {flag: 'wx', mode: 0o600});
writeFileSync(join(directory, 'synthetic-input.png'), fixture.png, {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({purpose: 'SYNTHETIC diagnostic arrows only, not the 80-frame character art deliverable',
  recipe: relative(root, join(directory, 'recipe.json')), approvedManifestSha256: fixture.recipeSha256,
  visualApproval: false, productionInstalled: false}, null, 2));
