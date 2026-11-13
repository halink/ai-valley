> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Formal model entry review

## Result

No blocking issue found in the formal-startup gate. This is a fail-closed wiring boundary for trusted application code, not permission to run a production model and not a sandbox against arbitrary code in this process.

Reviewed `src/server/formal-startup.ts`, `src/server/production-model-policy.ts`, their original regression tests, and the relevant runtime, main, observer health, and store paths.

## Safety and accuracy

- Nonempty and nonarray providers are rejected before listening, acquiring database ownership, opening a store, or constructing a runtime. No provider credential needs to be inspected.
- Startup constructs its own empty provider array after the listen await. Mutating or replacing the caller's array, or defining custom array methods, cannot inject a connection into this path.
- Factory policies contain only primitive fields and are frozen. WeakSet identity rejects fabricated, copied, serialized, inherited, and proxy-wrapped policies without reading policy properties. Capturing the accepted object before awaiting prevents later replacement of the options property from changing health.
- Omitting policy creates a disabled policy without consulting process environment or secrets. Formal main still explicitly supplies its environment-derived diagnostic policy. Health reports readiness false, execution disabled, and unknown cost (`null`), not verified zero cost.
- Restarting with stale synthetic persisted `configured: true` does not recover providers. The runtime resets configured status and pauses when constructed with the empty list.

## Compatibility and limits

- Supplying bare providers is now deliberately incompatible, including alongside a valid disabled policy. Callers must use the no-model entry; this patch adds no live activation route.
- Structurally identical policies from JSON, object spread, or another module instance are deliberately rejected. Callers should obtain policy from the same imported factory. Both factory `blocked` and `no-model` diagnostic states remain valid disabled policies.
- Direct construction of `ValleyRuntime` still has a default model transport. This patch protects `startFormalServer`, not arbitrary use of lower-level runtime APIs or monkey-patching by trusted process code.
- Other mutable startup options, including the database path, are not snapshotted by this patch. That is outside the model-entry guarantee. Accessor side effects and globally modified builtins are also outside this trusted-code boundary.
- This review does not establish production budget, price verification, admission, transport, supervision, or crash-recovery readiness. Those require separate implementation and review before any live entry exists.

## Independent verification

`tests/formal-model-entry-review.test.ts` adds four regressions: opaque/prototype/primitive policy rejection, hostile empty-array methods, asynchronous policy replacement, and reopening stale synthetic save state. Every case installs a throwing fetch stub; socket listen is stubbed and only temporary synthetic databases are used. No model network, secret file, real save, or run artifact is accessed.

Final validation: `node --import tsx --test tests/formal-model-entry.test.ts tests/formal-model-entry-review.test.ts` passes all nine tests (five implementation regressions and four independent review regressions). `npm run check` exits successfully. The initial review found inferred `void` return types in two throwing credential getters in the original tests; the implementation owner added explicit `string` return annotations, and this review independently verified the fix and reran both checks.
