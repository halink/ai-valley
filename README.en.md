# AI Valley / 栖谷

[中文](README.md)

An observation-only valley that grows through its residents' lives. The new delivery target is **Godot 3D in the browser**, with a painterly visual style. Native desktop game delivery and mobile support are not targets. Godot is a developer/export tool, not a player installation requirement.

## Current engineering MVP

The initial world contains a small map, two residents, a shared home, food and water. The backend owns action execution and world state; the browser observes that state through a read-only interface. Movement traces, room observation, basic poses, Chinese UI and painterly materials are implemented, but implementation is not visual acceptance.

The current Web entry is a **temporary rules-driven demo**. It does not read `.env`, call models or save the world; restarting the server resets it. A separate persistent service and explicit primary/backup model wiring exist, with a separate same-origin persistent Web entry; real-model acceptance remains incomplete. Features in the older simulation are not automatically features of this MVP.

## Local developer demo

Building requires Node.js **22.13+**, Godot **4.6.3 stable** on PATH and matching official Web export templates.

```sh
npm ci
npm run build:godot:web
npm run demo:godot:web
```

Open <http://127.0.0.1:3414> in a browser on the server's computer and click the connect button. This is a local address, not a public deployment. The browser needs WebAssembly and WebGL 2; players do not install Godot. See [Web MVP instructions](docs/godot-web-mvp.md).

`npm run dev`, `npm run dev:web` and `npm run demo:godot:web` start the same rules Web service; do not run them together. `npm run build` only checks TypeScript and compiles the backend; `npm start` runs that compiled service. Web assets still require the separate `npm run build:godot:web` command. None of these commands starts the persistent model service.

## Verification boundaries

A Web release export and isolated HTTP/snapshot/rules checks have succeeded. Headless checks do not establish browser rendering, GPU behavior or real-model acceptance. The verification browser could not reach the loopback service started in another execution session, so actual graphics, Chinese text and interaction remain unverified.

Persistence belongs to the server. The existing persistent service's storage lock is Linux-only; this does not prevent a Mac browser from viewing a Linux-hosted game. Persistent Web browser acceptance, public HTTPS deployment, access control and real-model validation remain unfinished. The project owner handles long-running validation. This is not an accepted long-running 1.0 release.

## Development

See [contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), [art credits](docs/art.md), [incremental roadmap](docs/godot-migration.md) and [design references](docs/design/README.md).

Deliver a small viable loop first, then expand mechanics and the map in tested increments. Retained concept images are references, not a requirement to reproduce the former 2D/2.5D design. Keep code, tests, review and documentation aligned; distinguish local commits from verified remote sync.

Never commit secrets, real saves, logs, caches or export output. Original source is [MIT](LICENSE); bundled third-party assets retain their own licenses.
