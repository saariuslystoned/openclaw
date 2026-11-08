# Shipped temporal-kind guidance proof

Source candidate: `137d398ed80839087a44e1efd25eead82d517752`, parent `f6abc882721d0facb24452469b77cf58b95d25a7`.

This text-only proof snapshot does not change the PR candidate. It records an actual foreground Gateway and shipped `dist/index.js` CLI built from that candidate, in a credential-free filesystem and private-network namespace with wholly new synthetic state. No production service or configuration was used.

The canonical baseline setup created the new config/agent/workspace without a model turn. The canonical config writer supplied its migration provenance; subsequent validation passed. Knowledge was selected through the memory slot with normal bundled-plugin startup. No hand-written provenance, grants, fake tool metadata, external plugin install, Doctor repair or admission override was used.

The real Gateway reached readiness (19 probes, 6,955 ms, namespaced PID 502). Actual shipped CLI calls to `tools.catalog` with `includePlugins:true` and `false` returned observed server payloads. The unchanged offline checker found exactly one each of `knowledge_timeline`, `knowledge_chronicle_day`, and `knowledge_chronicle_since`, all resolved from plugin `knowledge`, with the optional string `kind` parameter carrying the shared guidance. All three were absent in the nonempty core-only inventory.

All three observed descriptions:

> Exact record.type filter, such as decision, event, or meeting; unlike search/lookup kind (page, claim, relationship). Omit to include all eligible dated types.

`TERMINAL.txt` contains the sanitized actual command/output excerpt; `receipt.json` binds runtime, source, response hashes, observations and cleanup. `catalog-check.json` is the actual unchanged checker output, not synthesized expected tool metadata. The ordinary repository wrapper completed one file/test with exit 0 (25,218 ms test, 72.51 s wrapper). Canonical process extinction, logical port-claim release and state cleanup all completed; test state and opaque fixture credentials existed only in tmpfs.

The outer observation fixture is archived exactly as executed in `gateway-case4.fixture.ts.txt`, with its original SHA256 in the manifest. Its helper/checker bytes are also unchanged. It is historical proof data, not a maintained product test or a new public API. To replay, stage the fixture at `extensions/knowledge/src/public-h5-gateway-case4-proof.test.ts` in a qualified exact-head checkout, with its own frozen dependencies and normal source-bound runtime build. Run `node scripts/run-vitest.mjs extensions/knowledge/src/public-h5-gateway-case4-proof.test.ts --maxWorkers=1`. The fixture expects an owned proof directory mounted at `/proof`, including helper names `h5-case4-make-patch.mjs` and `h5-case4-check-catalog.mjs`, private loopback only, isolated `/tmp`/`/tmp/openclaw`, and no real HOME/config/credentials/sockets. Do not run it against existing state. The `make-case-patch.mjs` JSON producer does not write configuration itself; the shipped config CLI owns those writes.

Scope limits: normal plugin loading is exercised; channels, providers, Gmail watcher, cron, browser control and canvas side effects are skipped. Workshop autonomy is off in the fresh synthetic config. This proves parameter guidance reaching a running Gateway/CLI consumer, not model understanding, production installation, all Knowledge operations, or final review/merge clearance. Earlier failed preparation cases (retired config, suppressed runtime stdout, and duplicate reservation cleanup) are retained at their original proof home and are not product defects or passing runs. The final fresh case resolved those fixture issues without changing the candidate or its admission guards.
