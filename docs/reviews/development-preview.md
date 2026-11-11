# Development preview: independent offline review

Review date: 2026-11-07. Scope: the default development launchers, preview session lifecycle, preview server entry, Vite preview configuration, and package scripts. This review does not change the formal writer or supervisor safety checks.

## Verified behavior

The default scripts select the dedicated preview entry; the explicit formal entry remains separate. The launcher accepts only no arguments or `--web`, uses absolute module paths and an absolute working directory, disables shell execution, and passes only string-valued Windows OS bootstrap variables to its child. Credentials, database paths, proxy settings, Node preloads, npm configuration, and temporary-directory overrides are not inherited by the child.

Preview sessions create a fresh private temporary directory and exclusively create `preview.sqlite`. They do not accept a database path. They initialize a synthetic world with no configured model providers and an injected rejecting model callback. The entry deliberately does not start the clock or model scheduler. The implementation tests verify separate worlds and no model fetch during a synthetic tick.

Independent regressions cover environment key case variants and inherited properties, malformed/extra arguments, absolute entry paths, initialization failure after SQLite creation, failures during runtime stop and database close, and cleanup of a symlink inside the temporary directory. The symlink points only to a separately created synthetic directory; its marker survives cleanup. No real archive or secret is involved.

## Findings communicated to the implementer

1. A child environment allowlist cannot sanitize the already-running parent. Node processes `NODE_OPTIONS` and explicit Node options before the launcher executes, and npm has its own startup behavior. This design is application-level isolation, not a sandbox for a hostile interpreter, npm configuration, modified dependencies, or a compromised checkout. Run with a trusted Node/npm startup environment. Directly invoking internal preview modules bypasses the launcher environment filter.
2. The initial Vite configuration rooted the server at the whole repository without a preview-specific file denial policy. Vite's ordinary defaults do not constitute a denial policy for SQLite archives or arbitrary key files elsewhere in that root. A loopback bind does not make such files safe to expose to every local client. The implementer was asked to restrict preview file serving. No real file was requested and no server was started to investigate this.
3. The launcher now uses explicit per-signal closures, making forwarding intent clear without relying on callback arguments or synthetic-event behavior. The implementer's read-only inspection of Node 24's built-in signal dispatch found that it passes the signal name; the earlier claim that real SIGINT forwarding was demonstrably converted to SIGTERM was incorrect. No real signal-delivery test was run.
4. The initial backend entry did not clean up its session if observer-server construction threw synchronously. The initial web entry likewise lacked close-on-listen-failure handling. These are startup lifecycle gaps, separate from the session's tested cleanup paths.

## Security and platform limits

- Temporary-directory ownership and database permissions are useful local protections, not a defense against the same OS user replacing files or modifying executable code. Tests do not attempt hostile same-user races.
- Recursive cleanup was checked only against synthetic child symlinks on Linux. It is not a guarantee of cleanup after SIGKILL, power loss, filesystem failure, or an unclosed native database handle after a constructor failure. Disposable files can remain after abrupt termination.
- Node's SQLite implementation and Windows file locks differ by platform. The platform-independent path assertions use `node:path`; the cleanup regression uses a directory junction on Windows and a directory symlink elsewhere, without a platform skip. Windows and macOS were not executed.
- The backend reuses the existing observer HTTP/static handler. Its static path checks are lexical and are not a general symlink sandbox. This review does not claim arbitrary files placed or linked under `dist` are safe to serve.
- A fixed proxy destination prevents an intentional formal-port default; it cannot authenticate whichever process already owns port 3413. A trusted local runtime remains an assumption.

## Offline validation

On Linux with Node v24.22.1, `node --import tsx --test tests/dev-preview-review.test.ts` passed **7/7**, with zero failures, skips, or cancellations. `node node_modules/typescript/bin/tsc --noEmit` passed. Scoped diff whitespace checking passed.

These checks import modules and create only new temporary SQLite worlds and synthetic markers. No service was started, no port was bound, no browser or npm command was used, and no network, `.env`, existing save, or credential file was accessed. No commit or push was made. This is not a full repository test pass, browser QA, live shutdown test, or real-model acceptance run. The findings above describe the initially reviewed code; subsequent implementation changes require a follow-up record before claiming they are resolved.

## Follow-up verification

The implementer added explicit SIGINT/SIGTERM forwarding, cleanup after synchronous observer construction failure, and Web server close-on-listen-failure. Static review confirms these changes. The Vite configuration now uses strict filesystem access, an explicit repository-root allowance, and denials for conventional environment/credential filenames, Git metadata, secrets, runtime/output directories, SQLite/database files and sidecars, and logs. Independent assertions pin those configuration choices.

Three additional tests transpile only the backend entry into an isolated VM and inject inert server/session/process objects. They verify constructor-failure cleanup, asynchronous listen-error cleanup with a failing exit code, and repeated shutdown signals closing connections and the session once. No HTTP module or socket is used. This verifies callback orchestration, not actual operating-system signal delivery or network-server teardown.

The resulting combined command `node --import tsx --test tests/dev-preview.test.ts tests/dev-preview-review.test.ts` passed **16/16**: five implementation tests and eleven independent review tests, zero failures/skips/cancellations. TypeScript no-emit checking passed again. Actual services, browser behavior, cross-platform operation, SIGKILL recovery, and real listen/shutdown races remain untested.

A further static check of the installed Vite 7.3.7 implementation found its default public-directory middleware explicitly disables the filesystem serving check. Thus `fs.deny` alone is not a policy for files placed in `public`. This was reported separately for the implementer to disable public-directory serving or document and enforce that directory's trust boundary. No real public file was read or served during this check.


## Final public-directory and environment follow-up

The preview now sets `publicDir:false`, removing the Vite public-directory serving bypass. Its plugin registers a pre-middleware that rewrites only the exact `/ai-town/favicon.svg` and `/ai-town/THIRD_PARTY_NOTICES.txt` aliases to their corresponding `/ai-town/public/` paths, preserving query bytes. Independent tests verify the two exact mappings, idempotence, one `next()` call, unchanged unknown/traversal/database/encoded paths, and direct registration rather than a post-hook. Static inspection of the installed Vite 7.3.7 middleware order confirms `configureServer` registration precedes base-path stripping and normal static filesystem checks. No Vite instance was created. This does not claim that all other repository files are inaccessible: ordinary root requests still use the documented filename/path denial policy.

The environment filter now enumerates keys before reading values. An independent throwing-getter regression verifies discarded credential, database, preload, home, and path values are never accessed. The cleanup regression now uses a Windows junction instead of skipping Windows; actual Windows execution remains unverified and failures will not be silently skipped.

Final focused validation after these changes: **20/20 tests passed**, comprising fifteen independent tests and five implementation tests, zero failures, skips, or cancellations. The earlier 7/7 and 16/16 counts are historical checkpoints. No unresolved blocker was found within the trusted-startup, synthetic/offline scope. Actual service lifecycle, live proxy/static delivery, browser rendering, and cross-platform behavior remain untested. Full-suite results belong to the implementing task and must be reported separately.
