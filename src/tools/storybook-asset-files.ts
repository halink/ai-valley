/** Repository-confined CLI I/O. No globbing, network, environment-file reads or installation. */
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, parse, resolve, relative} from 'node:path';
import {assembleStorybookAssets, assetRelativePath, BUILD_LIMITS, parseStorybookBuildRecipe, storybookBuildFiles} from './storybook-asset-pipeline.js';
import {sha256} from './storybook-png.js';

function fail(reason: string): never {throw Error(`invalid_storybook_asset_files: ${reason}`);}
function directory(path: string): void {const s = lstatSync(path); if (s.isSymbolicLink() || !s.isDirectory()) fail('unsafe_directory');}
function rootChecked(root: string): string {
  const absolute = resolve(root), base = parse(absolute).root; let current = base; directory(current);
  for (const part of absolute.slice(base.length).split('/').filter(Boolean)) {current = join(current, part); directory(current);}
  return absolute;
}
function confined(root: string, path: string): string {
  const local = assetRelativePath(path), absolute = resolve(root, local), rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || /(?:^|\/)docs\/design(?:\/|$)/.test(rel)) fail('path_escape');
  let current = root;
  for (const part of local.split('/').slice(0, -1)) {current = join(current, part); directory(current);}
  return absolute;
}
function readRegular(root: string, path: string, maxBytes: number): Buffer {
  const absolute = confined(root, path), before = lstatSync(absolute);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) fail('unsafe_input_file');
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || stat.size !== before.size || stat.ino !== before.ino || stat.dev !== before.dev) fail('changed_input_file');
    const bytes = Buffer.alloc(stat.size); let offset = 0;
    while (offset < bytes.length) {const count = readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) fail('changed_input_file'); offset += count;}
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) || fstatSync(fd).size !== bytes.length) fail('changed_input_file');
    return bytes;
  } finally {closeSync(fd);}
}
const usage = 'Usage: node --import tsx scripts/storybook-assets.mjs check|build|verify RECIPE.json [output/storybook-assets/NEW_DIRECTORY] --approved-manifest-sha256=HEX';
/** Permission must come from the user, not from an untrusted manifest. The hash pins that selection. */
export function runStorybookAssetCli(args: readonly string[], repository: string): string {
  const command = args[0];
  if (command === '--help' && args.length === 1) return usage;
  if (!['check', 'build', 'verify'].includes(command)) fail(usage);
  const count = command === 'check' ? 3 : 4;
  if (args.length !== count || !/^--approved-manifest-sha256=[a-f0-9]{64}$/.test(args[count - 1])) fail(usage);
  const approvedHash = args[count - 1].slice('--approved-manifest-sha256='.length), root = rootChecked(repository);
  const recipePath = assetRelativePath(args[1], '.json'), recipeBytes = readRegular(root, recipePath, 4_000_000);
  if (sha256(recipeBytes) !== approvedHash) fail('approved_manifest_hash_mismatch');
  const recipe = parseStorybookBuildRecipe(JSON.parse(recipeBytes.toString('utf8')));
  const sources = new Map<string, Uint8Array>(); let bytes = 0;
  for (const s of recipe.sources) {
    const path = relative(root, resolve(root, dirname(recipePath), s.path));
    const value = readRegular(root, path, Math.min(72_000_000, BUILD_LIMITS.sourceBytes - bytes)); bytes += value.length; sources.set(s.id, value);
  }
  const result = assembleStorybookAssets(recipe, sources, approvedHash), files = storybookBuildFiles(result);
  if (command !== 'check') {
    const output = assetRelativePath(args[2]);
    // Build products remain review candidates. Never overwrite a runtime atlas or user design files.
    if (!/^output\/storybook-assets\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(output)) fail('output_requires_new_candidate_directory');
    if (command === 'verify') {
      for (const [name, expected] of files) {
        const actual = readRegular(root, `${output}/${name}`, Math.max(expected.length, 1));
        if (!actual.equals(Buffer.from(expected))) fail(`rebuild_mismatch.${name}`);
      }
    } else {
      for (const part of ['output', 'output/storybook-assets']) {
        const path = join(root, part); try {mkdirSync(path, {mode: 0o700});} catch (e) {if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;}
        directory(path);
      }
      const target = confined(root, output); mkdirSync(target, {mode: 0o700});
      try {
        // Receipt is last. A failed write removes only this newly owned directory.
        for (const [name, value] of files) writeFileSync(join(target, name), value, {flag: 'wx', mode: 0o600});
      } catch (error) {rmSync(target, {recursive: true, force: true}); throw error;}
    }
  }
  return JSON.stringify({command, purpose: result.report.purpose, profile: result.report.profile, packId: result.manifest.packId,
    atlasSha256: result.manifest.atlas.sha256, width: result.manifest.atlas.width, height: result.manifest.atlas.height,
    animationFrameCount: result.report.animationFrameCount, duplicatePixelCount: result.report.duplicatePixels.length,
    status: result.report.status, visualApproval: false, productionInstalled: false});
}
