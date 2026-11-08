# Knowledge canonical-equivalence candidate proof

Source repository: openclaw/openclaw. Issue: https://github.com/openclaw/openclaw/issues/195031
Base: 0622e93a295d4721344d77ae67f7b0c5bac859ea
Candidate: c867535489f22295faa42cebd6c843cb8b18d0eb, four source files. Sole source/test/diagnostic author: RoboClaw. Coordinator independently executed and staged unchanged bytes. No merge, production action, real memories or model calls.

## Result and limits

Canonical-equivalent queries now find NFC/NFD source spellings across titles, joined aliases, bodies, current/history indexes and filtered corpora. Original source bytes, hashes, revisions, snippets and Markdown locations remain original. The projection format participates in snapshot AND tracked-row hashes, refreshing unchanged old rows.

57 tests across four files passed on final formatted candidate: retrieval (22), memory-provider (16), ingestion (14), record-capacity (5). One worker; wrapper wall 215.663 seconds. Reported test-duration sums: retrieval 29.991s, memory-provider 33.768s, ingestion 38.004s, record-capacity 7.485s. Existing real store/SQLite/worker integration proves scope, citation, failure/recovery and consumer contracts that standalone normalization units cannot. Two added owning scenarios cover canonical retrieval and original snippet origins. Timeouts/assertions were preserved. CI seconds are unavailable: no PR exists.

Final candidate production extension types, full tracked extension test types, targeted type-aware lint, local oxfmt and diff checks PASS. Runtime-only proof fixtures were preserved unchanged outside compiler inputs after runtime jobs ended; no compiler exclusions or tracked-test removal. Local oxfmt is supported tooling, not CI Bun-parity evidence. Full shipped build/Gateway/UI proof is not supplied here.

## Real old-index migration

The unchanged corrected registered-tool driver first ran BASE code at 0622e93a295d4721344d77ae67f7b0c5bac859ea, using an initially empty fictional store. It completed all six query and six history stages, hard controls, normal worker shutdown and an actual old-index receipt: eight source hashes, current six rows/history two rows. Twelve intended canonical soft assertions failed. No FTS rows were hand-seeded. The old receipt SHA256 is d9ac813ca6a379568ffdcae8f634cd3dec4cd5b344c0aa719d1eb6ba7f08986f.

Original implementation packet 9a820c643411e295d162871034742cdb214e2696bcde95cd2cec71f10caf4e6e then consumed exactly that retained same-path store: PASS, 54.517s wrapper/4.024s test. Current AND history raw projections refreshed to NFC; original eight hashes and old receipt stayed unchanged; full/compact original text/lines passed. After a normal reopen/repeat query/stop, the complete keyword index image stayed identical. That proves retained image reuse, not zero SQL statements.

Migration evidence belongs to original implementation hashes: retrieval.ts e0c792938ab462237ddda35267c6a3bbc3b50aeae37f0b43b216c3deacffe4be, retrieval.test.ts 58ad6b5c8deaa9342167a794c77dcd507a48120c472a7b249e430e28003afa04. Final packet d93280a78dff2e8b1115866091267c7de611e3d92b48c96acd5d19bb60880cde changes precisely two formatting hunks plus measured allocation163→168; docs identical. Format-only.patch is included. Migration was not relabelled as rerun on final bytes. Final full owning/consumer suites/types/lint/format ran on final bytes. Do not rerun candidate phase on the already upgraded store: the driver requires its original old image initially.

## Compatibility disclosure and retained red diagnostic

NFC projection removes storage-spelling-dependent matching. An unaccented Greek query that previously matched only an NFD spelling can cease matching after refresh; the accented query matches either original spelling. Greek accent-insensitive search is not added. Existing unicode61 consumes a separate combining acute but retains precomposed Greek ά.

The original 4817-byte diagnostic remains unchanged (SHA256 e4aabdee893aceb7457797f1115f81eeed037c60658035d786300125ac9fd4ac). Base: three canonical and two unaccented-Greek failures. Candidate: ZERO canonical failures and THREE unaccented-Greek failures, all exact/Latin/unrelated/source-hash/revision controls held through three stages. This is a real compatibility effect of the specifically assigned NFC+unchanged-tokenizer route, explicitly accepted/disclosed by the coordinator, not a full-green diagnostic or generic accent-folding fix.

Five-case FIFO contributor-origin diagnostic previously passed 169 assertions; prior immutable counterexample proof: https://github.com/saariuslystoned/openclaw/blob/f62f8b47e08f843ca88fb532a423b045f311e366/proof/canonical-origin-counterexample-bffe6728/PROOF.md . Finite diagnostics do not establish a formal universal Unicode theorem.

## Test-line budget gate — deliberately still red

Final positive net test growth is168 LF lines, allocated exactly168 in the issue-specific record. Exact staged checker exited1: tracked total6,574,590; ceiling6,574,578; over12. Derived base total6,574,422 versus base ceiling6,574,410 establishes inherited12 debt. This positive-growth checker failure is NOT called an unchanged baseline pass. Untracked diagnostics do not count. Shared scalar and unrelated tests are untouched.

An OPTIONAL exact grant168→180 would cover168 own lines+12 inherited debt, producing ceiling6,574,590 with ZERO spare headroom. It is NOT APPLIED or authorized. Current source commit retains168 and the actual red result. docs/ci/local-proof.md#test-line-budget and .agents/skills/openclaw-testing/SKILL.md#baseline-and-expected-failure-exceptions require approval for raises beyond own net growth. The parent coordinator owns the prepared approval question; silence or another lane's grant does not authorize it.

## Reproduction and remaining gates

Use owned frozen dependencies and secretless, network-unshared disposable state. Commands executed through repository wrappers:

- node scripts/run-vitest.mjs extensions/knowledge/src/retrieval.test.ts --maxWorkers=1 -t 'canonical queries share|NFC highlight origins' against base production: intended two-test RED.
- H21_UPGRADE_PHASE=base|candidate H21_UPGRADE_ROOT=/proof/retained-store node scripts/run-vitest.mjs extensions/knowledge/src/public-canonical-upgrade-proof.test.ts --maxWorkers=1, same path/database between phases.
- node scripts/run-vitest.mjs extensions/knowledge/src/retrieval.test.ts extensions/knowledge/src/ingestion.test.ts extensions/knowledge/src/memory-provider.test.ts extensions/knowledge/src/record-capacity.test.ts --maxWorkers=1
- node scripts/run-tsgo.mjs -p tsconfig.extensions.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/extensions.tsbuildinfo
- node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.extensions.test.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/extensions-test.tsbuildinfo
- node scripts/run-oxlint.mjs --type-aware --tsconfig extensions/tsconfig.json extensions/knowledge/src/retrieval.ts extensions/knowledge/src/retrieval.test.ts
- node scripts/run-format.mts --check extensions/knowledge/src/retrieval.ts extensions/knowledge/src/retrieval.test.ts docs/plugins/knowledge/retrieval.md (supported localoxfmt selection)
- node --import ./scripts/tsx.mjs scripts/check-test-lines-ratchet.mts --staged --base 0622e93a295d4721344d77ae67f7b0c5bac859ea --no-merge-base (FAIL12 inherited debt)
- git diff --cached --check (PASS)

Earlier failed driver supplied tag:undefined and correctly hit the real JSON boundary; same author corrected only the absent key. Root's first v2 case omitted a required empty subdirectory and failed ENOENT; root corrected setup in a NEW case. All failed cases/raw local evidence retained. Neither setup failure was accepted as migration RED. Raw public test logs below have ANSI removed only; failure history and exact original log hashes remain in local receipts. No real credential stores, auth logs or private memories are included.

CI, comprehensive Spark-2 P0–P3 exact PR/base/head review, native published exact-head review, and human-approved merge remain PENDING. A new PR may be created solely by the existing shared publisher queue; this source/proof ref creates no PR. The review route requires a real PR tuple, so no partial/P0 substitute or duplicate reviewer was launched. Actual shipped Gateway/UI proof is separate and remains unsupplied; registered synthetic-host proof is not relabelled as that behavior.
