// Explicit offline asset candidates only. Invoke with node --import tsx.
import {fileURLToPath} from 'node:url';
import {runStorybookAssetCli} from '../src/tools/storybook-asset-files.ts';
try {console.log(runStorybookAssetCli(process.argv.slice(2), fileURLToPath(new URL('../', import.meta.url))));}
catch (error) {console.error(error instanceof Error ? error.message : 'storybook_asset_pipeline_failed'); process.exitCode = 1;}
