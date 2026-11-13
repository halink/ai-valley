// Offline synthetic checks only. Does not download Godot or start a server.
import {spawnSync} from 'node:child_process';
import {cpSync, lstatSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve, basename, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output');
mkdirSync(output, {recursive: true});
const temporary = mkdtempSync(join(output, 'godot-headless-'));
const binary = process.env.GODOT_BIN || 'godot';
const suites = ['snapshot', '3d', '3d_client', 'motion', 'observation', 'launch_modes', 'picking', 'interior', 'character', 'panel', 'action_poses', 'materials'];
// Do not pass API keys, NODE_OPTIONS, dotenv settings, proxy credentials or the
// user's Godot profile into the engine. These fixtures override transport.
const env = {PATH: process.env.PATH || '', LANG: 'C.UTF-8', GODOT_SILENCE_ROOT_WARNING: '1'};
for (const [key, directory] of Object.entries({HOME: 'home', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_CONFIG_HOME: 'config'})) {
  env[key] = join(temporary, directory);
  mkdirSync(env[key], {mode: 0o700});
}
function run(args, label, timeout, requirePass = false) {
  const result = spawnSync(binary, args, {cwd: root, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024});
  const text = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(text);
  // Godot can emit script errors without a nonzero exit. Exit status alone is
  // not a reliable assertion gate; a completion marker is also mandatory.
  if (result.error || result.status !== 0 || /(?:SCRIPT ERROR:|ERROR:|Assertion failed)/i.test(text) || (requirePass && !/^PASS: /m.test(text))) {
    throw new Error(`${label} failed (${result.error?.code || result.signal || result.status}); no pass inferred`);
  }
  return text;
}
try {
  const version = run(['--version'], 'engine version', 10000).trim();
  if (!/^4\.6\.3\.stable(?:\.|$)/.test(version)) throw new Error(`Expected Godot 4.6.3 stable, got ${version}`);
  const project = join(temporary, 'project');
  // Always import a fresh source copy. Never reuse the working tree's .godot
  // cache or copy saves/configuration. Ignore symlinks rather than following them.
  cpSync(join(root, 'godot-client'), project, {recursive: true, filter: (source) => {
    const name = basename(source);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) return false;
    if (name.startsWith('.') || name === 'node_modules') return false;
    // cpSync filter receives directories too; only source/resource types below
    // are admitted as files (project.godot is explicitly allowed).
    return stat.isDirectory() || name === 'project.godot' || ['.gd', '.gdshader', '.uid', '.tscn', '.tres', '.png', '.svg', '.ttc', '.ttf', '.otf'].includes(extname(name));
  }});
  run(['--headless', '--editor', '--path', resolve(project), '--import'], 'clean resource import', 120000);
  for (const suite of suites) {
    console.log(`\n--- ${suite} ---`);
    run(['--headless', '--path', resolve(project), '--script', `res://tests/test_${suite}.gd`], suite, 30000, true);
  }
  console.log(`PASS: ${suites.length} offline headless suites (not GPU, HTTP, real-model or long-run acceptance)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
