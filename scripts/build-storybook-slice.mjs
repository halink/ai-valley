/** Explicit offline asset export. No model, world, environment file or saved state. */
import {mkdirSync, writeFileSync} from 'node:fs';
import {buildSliceAssets} from '../src/tools/storybook-slice-build.ts';
const destination = new URL('../src/client/assets/storybook/', import.meta.url);
mkdirSync(destination, {recursive: true});
const {png, manifest} = buildSliceAssets();
writeFileSync(new URL('geometry-slice.png', destination), png);
writeFileSync(new URL('geometry-slice.manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Calibration only: ${manifest.atlas.width}x${manifest.atlas.height}, ${png.length} bytes, ${manifest.atlas.sha256}`);
