# AI Valley

[简体中文](README.md)

AI Valley is an observation-only simulation. Nine residents settle a valley, gather food, care for families, trade, and build. Language models choose each resident's actions. The simulation checks travel, materials, ownership, time, and consent before those actions take effect.

Fish, livestock, wildlife, fields, and settlements share the same world. You can follow residents on the map, inspect animal activity, browse relationships and history, and watch designs turn into real tools and buildings. The current interface and resident dialogue are in Chinese.

Private non-residential workshops and stores now support finite, independently accepted leases and daily workstation windows. Rent, refundable deposits, onsite stock, and earned wages stay separate. Limited local business relocation now requires settling original-site commitments, independent employee consent, and physical stock transport, while preserving wages, contract end dates, and attendance. [Limited single-adult residential stays (Chinese)](docs/implementation/residential-leases.md) now support independent acceptance, escrow, and physical bed use in vacant private homes. Shared residential tenancy and permanent move-in remain pending. See the [relocation scope and verification limits (Chinese)](docs/implementation/business-relocation.md). See the [scope and tests (Chinese)](docs/implementation/premises-leases.md).

[Limited freight ferries (Chinese)](docs/implementation/freight-ferry.md) now connect existing foreign consignments through explicit land-water-land handoffs. Owners and captains decide separately, passengers and cargo share capacity, and real unloading and shore handoffs govern separate freight and sale settlement. Floods, returns, spoilage, and restarts retain physical custody. Alternate-port agreements and long-running model validation remain pending.

[Limited later-life support (Chinese)](docs/implementation/later-life.md) adds voluntary shorter work sessions and separately consented care handoffs, preserving earned wages, real supplies, and autonomy. Bounded slower sleep recovery is implemented and tested in isolation, but remains disabled pending the cross-season survival baseline.

[Solo adult visits (Chinese)](docs/implementation/visitor-journey.md) now use independently chosen, bounded walking stages with carried-food meals, sitting rest, and actual-distance turnback. Blocked routes, incapacity, and restarts do not resume travel automatically. [Adult-relative journeys (Chinese)](docs/implementation/adult-family-journey.md) also require both adults to confirm each stage, move at the slower pace, and choose their own self-care or explicit separation. This does not add reception promises, free supplies, or child-family arrivals.

Bounded social behavior now includes [persistent personal relationship memory (Chinese)](docs/implementation/relationship-decision-memory.md), [spoken words and tone (Chinese)](docs/implementation/dialogue-content.md), and [rotating interpretation choices (Chinese)](docs/implementation/interpretation-rotation.md). Face-to-face choices check actual visibility and access, offer all three tones, and never change relationships automatically. [Face-to-face berry clues (Chinese)](docs/implementation/food-source-sharing.md) now convey a chosen firsthand historical address to one actual listener, with source and timestamps. The listener independently chooses whether to inspect it, gather, and eat; no automatic relaying or stock creation occurs. Ordinary in-valley menu budgets sum to a theoretical maximum of 84 choices, including [crop planting](docs/implementation/plant-crop-menu.md) and [rotating known field addresses](docs/implementation/known-land-menu.md), with independent stop/withdrawal controls restored separately. See the [menu scope (Chinese)](docs/design/simulation.md).

[Continuous indoor/outdoor following (Chinese)](docs/implementation/resident-follow.md), [limited child care (Chinese)](docs/implementation/emergency-child-care.md), [protected property custody (Chinese)](docs/implementation/protected-custody.md), and [local public food procurement (Chinese)](docs/implementation/public-food-reserves.md) are implemented with separate consent, ownership, physical-stock, and failure boundaries. They do not guarantee continuous care or settlement-wide food supply.

[Two-adult social appointments](docs/implementation/social-appointments.md) support a face-to-face invitation and independent reply for a future public-lodge rendezvous. Each person separately chooses to walk, wait, speak or leave. Profiles distinguish world facts from personal knowledge; remote withdrawal is not an automatic notification.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

In a second terminal run `npm run dev:web`, then open the [isolated preview](http://127.0.0.1:5173/ai-town/). Each backend launch creates a new temporary SQLite database on port 3413. It does not read saved worlds, `.env` files or model credentials, call external models, or advance the world clock. Normal shutdown removes its temporary data. Frontend hot reload is supported; restart the backend manually after server changes.

The **full test suite requires Linux**, including `/proc`, secure directory descriptors and POSIX process groups. macOS and native Windows cannot run the full suite as-is; use a Linux host or WSL2's Linux filesystem. No platform tests are silently skipped. The [contribution guide](CONTRIBUTING.md) lists partial checks, which do not replace the full suite. Cross-platform execution has not been verified.

For a persistent observer, run `npm run build` and `npm start`, then open the [formal observer](http://127.0.0.1:3412/ai-town/). **This opens or creates `runtime/formal.sqlite` and may migrate and commit the saved world. It is not an isolated preview. The formal entry currently defaults to `no-model`, does not read model credentials, and cannot make implicit model calls.** A requested live mode reports `blocked` until authorization, current free availability, and the previous uncertain request are reconciled. Existing keys or environment claims of free pricing do not enable it. The [production safety candidate (Chinese)](docs/implementation/production-model-safety.md) uses only synthetic transport; live production model wiring is not complete.

The observer still defaults to 2D, with an optional [2.5D trial](docs/implementation/isometric-formal-entry.md). The [clinic interior extension](docs/implementation/isometric-clinic.md) reuses actual room layouts, beds, table, static kitchen and original people. It invents no medicine, equipment or patients; medical gestures remain unsupported, and presence does not imply treatment or cure. The [school interior extension](docs/implementation/isometric-school.md) likewise reuses actual tables, static kitchens and recorded people without inventing desks, blackboards, books or teaching gestures. Presence never proves learning progress or completion. Its offline engine route explicitly adds a synthetic school building because the original seed has none. The [barn interior extension](docs/implementation/isometric-barn.md) adds the actual layout and recorded people; pen markers are navigation points, not animal locations or occupancy. Animals with only barnId/pen remain unlocated and are not drawn; husbandry gestures remain unsupported. Unsupported rooms and poses retain explicit fallback. Browser, touch and GPU acceptance is still outstanding.

The formal startup ownership lock currently supports Linux only and fails closed elsewhere. This remains a cross-platform release blocker, not a 1.0 readiness claim. `npm run dev:formal` uses the same persistent-save and model restrictions; `dev:web` does not proxy to it.

See the [configuration guide](docs/configuration.md) for providers, save files, and hosting. The [contribution guide](CONTRIBUTING.md) covers development and tests.

Local shop trades support resident-chosen quantities, tax-inclusive buyer limits, absolute supplier proceeds floors, and explicitly authorized partial fills. Settlement checks real stock, original food lots, all payment legs, and durable replay receipts. See the [bulk-trading scope and tests (Chinese)](docs/implementation/bulk-trading.md).

Each resident in a new nine-person settlement carries at least three days of edible provisions. Food is finite and expires; existing saves receive no extra supplies. See the [opening provisions and tests (Chinese)](docs/implementation/founding-provisions.md).

[Food observation (Chinese)](docs/implementation/food-coverage.md) separates conservative individual food estimates from deduplicated community stock equivalents. Neither guarantees survival or access for everyone. After building, `node scripts/acceptance-long-run.mjs 1 --daily-json` emits [daily factual evidence (Chinese)](docs/implementation/isolation-evidence.md) from a model-free isolated fixture. Optional [food-flow evidence (Chinese)](docs/implementation/food-flow-evidence.md) now includes seed saving and fish-drying prototype trials; meals, spoilage, and limited boundary transfers remain separate slices. Complete supply/consumption totals are still unknown.

The [first supply-only water stage (Chinese)](docs/implementation/safe-water-supply.md) adds finite buckets, actual collection and kitchen boiling, guardian-assisted drinking, and voluntarily donated public water. [Explicitly authorized adult assistance and independently accepted bucket gifts to minors (Chinese)](docs/implementation/water-support.md) add narrow, revocable support paths. Legacy water stocks remain intact. Resident thirst and dehydration are not enabled.

[Species-specific fish stocks and catches (Chinese)](docs/implementation/fish-species.md) now connect fishing and predation to the same species counts, distinct physical goods, meals and mixed preservation, seasonal reproduction and conserved migration between connected waters. Legacy generic fish lots remain unchanged. Isolated extinct stocks do not refill themselves; four-season ecological balance is still unverified.

[Finite wolf and fox ecology (Chinese)](docs/implementation/predator-ecology.md) adds physical habitats, opposite-sex breeding, dependent-young nutrition, stepwise migration, and wildlife disease and mortality records. Existing saves receive no new mates; extinct predator populations do not respawn. Long-term food-web balance remains unverified.

[Finite boar, deer, hare, and duck populations (Chinese)](docs/implementation/wildlife-population.md) use actual parents, dependent-young needs, reserved birth capacity, and recorded taming exits. Old saves receive no new animals and extinction no longer triggers replacement spawns. Tamed pregnant ducks retain their existing pregnancy and need space for both mother and offspring. Migration for these four species and long-term ecological balance remain outside this delivery.

[Formal nine-resident, fifteen-day acceptance (Chinese)](docs/implementation/nine-resident-acceptance-preparation.md) has offline preparation, an evidence writer, exact-endpoint/stop controls, and synthetic process-supervision components. They remain opt-in. A real-model runner and production supervision wiring are not implemented, and model use, costs, and the scope of transmitted data still require explicit user authorization. Browser visual acceptance, the real-model first fifteen days, and four-season balance remain unverified. New weather-hazard scheduling is disabled by default; existing hazards still progress.

The [game design guide (Chinese)](docs/design/README.md) documents the opening world, ecology, generations, economy, construction, and observer experience. The [survival forecast benchmark (Chinese)](docs/implementation/survival-performance.md) documents the controlled nine-resident performance results and their limits; end-to-end service latency and large-population worst cases remain unverified.

Original project source and documentation use the [MIT license](LICENSE). See the [third-party notices](public/THIRD_PARTY_NOTICES.txt) and [art credits](docs/art.md) for separate credits and terms.

## Observer interface

The default entry uses the [storybook UI](docs/implementation/storybook-ui-shell.md): six desktop destinations, an object card, on-demand records, and mobile navigation with expandable drawers. Existing follow, room, atlas and archive actions remain available without a development query parameter. Map and portrait assets are unchanged. UI integration does not mean the hand-painted map or 2.5D art is complete; actual browser, touch and accessibility acceptance remains outstanding.
