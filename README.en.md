# AI Valley / 栖谷

[中文](README.md)

An observation-only valley that grows through its residents' lives. The new delivery target is **Godot 3D in the browser**, with a painterly visual style. Native desktop game delivery and mobile support are not targets. Godot is a developer/export tool, not a player installation requirement.

## Current engineering MVP

The preview has four residents in a painterly valley with viewable interiors. The Node backend executes actions and saves the world. The browser provides a read-only view. Local development runs a temporary rules-driven world. A persistent deployment can enable models for resident decisions. [Verified build and upcoming milestones](docs/godot-migration.md#当前版本与证据)

## Local developer demo

Building requires Node.js **22.13+**, Godot **4.6.3 stable** on PATH and matching official Web export templates.

```sh
npm ci
npm run build:godot:web
npm run demo:godot:web
```

Open <http://127.0.0.1:3414> in a browser on the computer running the local service. The page connects automatically and offers a reconnect button. The browser needs WebAssembly and WebGL 2. See [Web MVP instructions](docs/godot-web-mvp.md).

`npm run dev`, `npm run dev:web` and `npm run demo:godot:web` start the same rules Web service; do not run them together. `npm run build` only checks TypeScript and compiles the backend; `npm start` runs that compiled service. Web assets still require the separate `npm run build:godot:web` command. None of these commands starts the persistent model service.

## Current acceptance policy (2026-11-16)

For each increment, development runs rule mode for **30 actual minutes**. If no issue is found, acceptance applies to the exercised scope. Do not run model-driven tests or add new test suites. Record real start/end times, simulation speed and coverage. Browser visuals are checked separately: accelerated game time, successful builds and segmented browser checks are not a continuous 30-minute browser run or evidence of long-term stability.

## Operations and verification

The persistent service uses SQLite on a local Linux filesystem. [Runtime and model configuration](docs/configuration.md) · [Deployment, backups and rollback](docs/deployment.md) · [Build, browser and rule-run records](docs/godot-web-mvp.md)

## Development

See [contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), [art credits](docs/art.md), [incremental roadmap](docs/godot-migration.md) and [design references](docs/design/README.md).

Deliver a small viable loop first, with visuals, UI and interaction developed alongside each feature, then expand mechanics and the map in verified increments. Retained concept images are references, not a requirement to reproduce the former 2D/2.5D design. Keep implementation, bounded rule verification, review and documentation aligned; distinguish local commits from verified remote sync.

Never commit secrets, real saves, logs, caches or export output. Original source is [MIT](LICENSE); bundled third-party assets retain their own licenses.
