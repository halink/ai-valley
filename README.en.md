# AI Valley

[简体中文](README.md)

AI Valley is an observation-only simulation. Nine residents settle a valley, gather food, care for families, trade, and build. Language models choose each resident's actions. The simulation checks travel, materials, ownership, time, and consent before those actions take effect.

Fish, livestock, wildlife, fields, and settlements share the same world. You can follow residents on the map, inspect animal activity, browse relationships and history, and watch designs turn into real tools and buildings. The current interface and resident dialogue are in Chinese.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm start
```

Open the [local observer](http://127.0.0.1:3412/ai-town/). It shows a paused starting world without credentials. To enable autonomous decisions, copy `.env.example` to `.env`, and enter at least one supported provider key. Use Node to load the environment file.

```sh
node --env-file=.env build/server/main.js
```

See the [configuration guide](docs/configuration.md) for providers, save files, and hosting. The [contribution guide](CONTRIBUTING.md) covers development and tests.

Original project source and documentation use the [MIT license](LICENSE). See the [third-party notices](public/THIRD_PARTY_NOTICES.txt) and [art credits](docs/art.md) for separate credits and terms.
