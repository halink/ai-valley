# Godot headless regression gate

`npm run test:godot` uses an already installed **Godot 4.6.3 stable** (`GODOT_BIN`
can select its executable). It never installs software or starts a server.
It copies only engine sources/resources to a unique disposable directory under
ignored `output/`, excludes symlinks/hidden files and starts with an empty import
cache and private HOME/XDG directories. No inherited API/model environment is
passed to Godot. The nine explicitly selected suites replace transport with
synthetic fixtures. HTTP/persistent tests are intentionally excluded.

The runner imports assets first (120 s deadline), then runs snapshot, 3d,
3d_client, motion, observation, launch_modes, picking, interior and character (30 s each). Each suite
must exit zero, emit its PASS marker and have no Godot ERROR/SCRIPT ERROR or
assertion failure. Version checking has a 10 s deadline. Temporary files are
removed after success/failure. This is an environment-isolated test runner,
not a network sandbox for arbitrary future test code; review any suite additions.

CI preserves all four TypeScript shards and adds a separate Linux x86_64 Godot
job. The existing `verify` aggregate now requires both jobs to succeed, including
failure/cancellation/skip handling. No npm install is needed for this extra job.
No imported asset or executable cache is restored: a stale cache must not hide
a missing asset or clean-import regression. Only the existing sanitized TS
artifacts are uploaded, not Godot profiles, saves or credentials.

## Supply chain and license

The official standard (non-.NET) release archive is pinned to 4.6.3. On
2026-11-12, the official release page and archive URL were accessible (archive
HEAD: 200, 71,806,687 bytes). The checksum below was read directly from the
release's official `SHA512-SUMS.txt`, not computed from the installed binary:

- Release: https://github.com/godotengine/godot-builds/releases/tag/4.6.3-stable
- Manifest: https://github.com/godotengine/godot-builds/releases/download/4.6.3-stable/SHA512-SUMS.txt
- Archive: `Godot_v4.6.3-stable_linux.x86_64.zip`
- SHA-512: `a035258da32b77f966a5376f9fa29c30a6adde826a85ba918e1605bd1fc9823eba7d85f1dd5e748956bd2ba72827c0025ffa11bb82aec91128c407a2e723c99c`

CI enforces the committed checksum before extraction/execution, restricts curl
to HTTPS and has bounded retries/timeouts. It does not trust a newly downloaded
checksum to approve a changed binary. Upgrades must review and update the
version, official manifest value and runner version gate together. This is
integrity pinning to an HTTPS official source, not a claim of independently
verified reproducible builds or release signatures.

Godot is MIT licensed: https://godotengine.org/license/ . CI does not vendor or
publish engine binaries/export templates. Distribution of a future game binary
must include Godot's copyright/license and relevant third-party notices; see
https://docs.godotengine.org/en/stable/about/complying_with_licenses.html .
Generated project texture provenance remains documented in `godot-client/art/`.

## Evidence boundary

Local clean import and nine offline suites passed using the preinstalled
4.6.3 engine. The download's manifest and availability were checked, but no new
engine was installed locally. **The new GitHub workflow has not yet run.** It
requires the commit to be pushed and its exact CI result checked. Headless
checks are not native GPU/window visual acceptance, HTTP integration, actual
model behavior, or long-running simulation acceptance.
