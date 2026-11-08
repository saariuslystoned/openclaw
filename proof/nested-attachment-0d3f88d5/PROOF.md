# Nested annotation attachment download proof

Source repository: openclaw/openclaw. Candidate: 0d3f88d56881af8d0aa45978d9d6d6de6739703b. Base: 4022f2d26eee88af6d1357701fb76b745cd758a2. Issue: https://github.com/openclaw/openclaw/issues/195052 . Recorded 2026-11-08T06:33:08.548250+00:00.

The exact three-file candidate is frozen. A valid externally edited portable record with only nested annotation evidence now downloads its cited attachment through the registered Knowledge operation. Top-level and restored cases still download the same bytes; unrelated record requests stay denied. Path, hash, partition, record and filesystem guards are preserved. The owning regression is part of the candidate.

## Independent observations

- Original unchanged fictional fixture on fresh base/current lock: exactly one intended assertion failed, canonical/nested-only/restored download true/false/true. All three stages stayed valid and verified with unchanged source/body/control bytes.
- Candidate owning regression over base production: exactly one intended `Attachment unavailable` failure, 13 tests filtered. It asserts ordinary positive and unrelated denial first.
- Exact candidate: 52 tests / 6 files PASS, wrapper 167.33s; original fixture true/true/true, controls held. The new owning case took 2712ms in the full run (4372ms on cold base). Existing real plugin/native SQLite cases account for most runtime. No CI runtime measurement yet.
- Local supported oxfmt PASS, type-aware oxlint PASS (0 warnings/errors), full tracked extension test types PASS, staged test-line ratchet PASS, diff whitespace PASS. Ratchet: 6573784 total / 6573827 ceiling; 46 measured added test lines have their own allocation, shared baseline unchanged.

## Commands

Node 26.13.0, Linux arm64, physical frozen pnpm12.15.0 dependencies. Runs used a cleared environment and network-unshared namespace with disposable wholly fictional state, normal test lifecycle/resource guards and one worker.

```sh
node scripts/run-vitest.mjs extensions/knowledge/src/evidence-read.test.ts extensions/knowledge/src/attachments.test.ts extensions/knowledge/src/public-portable-annotation-proof.test.ts extensions/knowledge/src/context-annotations.test.ts extensions/knowledge/src/source-descriptor-integration.test.ts extensions/knowledge/src/vault.test.ts --maxWorkers=1
node scripts/run-vitest.mjs extensions/knowledge/src/evidence-read.test.ts --maxWorkers=1 -t 'externally edited nested citations retain record-scoped downloads'
OPENCLAW_FORMAT_TOOL=oxfmt node scripts/run-format.mts --check extensions/knowledge/src/vault.ts extensions/knowledge/src/evidence-read.test.ts
OPENCLAW_LINT_TOOL=oxlint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/knowledge/src/vault.ts extensions/knowledge/src/evidence-read.test.ts
node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.extensions.test.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/extensions-test.tsbuildinfo
node --import ./scripts/tsx.mjs scripts/check-test-lines-ratchet.mts --staged --base 4022f2d26eee88af6d1357701fb76b745cd758a2
git diff --cached --check
```

The original fixture is shipped here as `.ts.txt`; copy unchanged to the named proof test path only for disposable runtime reproduction. It is an observation fixture, not candidate source or a permanent typechecked test. Its runtime passed on the candidate, but a separate full test-type pass caught TS2345 at its line152 (unknown date narrowing). After runtime completion the unchanged fixture was moved outside compiler inputs; all tracked extension tests then typechecked. Both observations are retained, with no source repair, exclusions, ignored errors or baseline change.

Initial setup had a missing scratch TMPDIR and failed before tests; only that directory was created before the identical base rerun. Initial CI formatter parity failed before checking because the minimal namespace lacked /bin/bash for pinned Bun staging. The supported local oxfmt/oxlint route passed; this is not Bun CI parity.

## Artifacts and limits

TERMINAL.txt contains sanitized selected terminal logs; result JSON and unchanged original fixture are alongside this file. manifest.json binds their sizes/hashes and all candidate hashes. Local host paths are redacted; synthetic record IDs and content remain.

This proves registered operation/native SQLite behavior with synthetic host authority. It does not prove live Gateway/UI, model behavior, production installs, full CI, or exact-head external review. CI, comprehensive Spark review and native published exact-head review remain required; human maintainer approval is required to merge. No merge or production action was performed.
