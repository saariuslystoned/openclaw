# Registered Knowledge exact-query reproduction for PR195092

Existing source owner: Linux2010. PR: https://github.com/openclaw/openclaw/pull/195092
Target owner module: 696aba6b90d5d7e8a373ca7605dda1a016fe7787:extensions/knowledge/src/retrieval.ts
Comparison consumer base: 0622e93a295d4721344d77ae67f7b0c5bac859ea

## Observed result

The exact same fictional body/query loses an existing match when the complete external owner module is substituted. Baseline passed the unchanged diagnostic; external module produced exactly THREE soft retention failures, with all independent result-set predictions and hard controls holding.

| Exact query and stored body | Mode | Baseline | External owner module |
| --- | --- | --- | --- |
| Mixed Greek: first word NFC, second NFD, `άλφα βήτα` | all | mixed row returned | two pure-spelling rows returned; mixed row absent |
| Same mixed Greek body/query | phrase | mixed row returned | two pure-spelling rows returned; mixed row absent |
| Partially normalized Korean: U+AC00 U+1102 U+1161 | all | Korean row returned | empty result |

The Korean case reproduces the ALREADY PUBLISHED P2 at https://github.com/openclaw/openclaw/pull/195092#issuecomment-6718823955 ; it is not claimed as a new finding. The Greek case makes the PR's disclosed mixed-form multiword gap concrete as a regression in an existing exact-spelling query. The attached matrix also records both canonical query forms missing the mixed Greek row. No source repair or competing PR is supplied.

The mixed Greek scalar sequence was asserted before fixture creation: U+03AC U+03BB U+03C6 U+03B1 SPACE U+03B2 U+03B7 U+0301 U+03C4 U+03B1. The Korean sequence was asserted too; neither witness contains backslash characters. Literal source escapes become actual Unicode scalars, and UTF-8 hex is recorded in both terminal logs.

## Boundary and source identity

This is actual registered knowledge_grep/knowledge_lookup/knowledge_record through the existing plugin, service and native SQLite storage, with the repository's SYNTHETIC host/tool fixture authority and five wholly fictional private records. No FTS rows were seeded. It is NOT a whole-external-PR build, shipped Gateway/UI run, model call, authentication proof or reviewer clearance.

The consumer projection uses the qualified062 base runtime files, with the COMPLETE retrieval.ts bound read-only inside each isolated process namespace:

- Baseline24082 bytes, SHA256 a558b8f30ea9f8e17a95d8477aa457ee51cac1624cb40fe434ae36dd2f285a9e, Git blob0ed68516ad9fee644069f9dcb44b47fd0a69cf26.
- External24916 bytes, SHA25698eebd73f7dce7ed7c9b4dce348885646c76376ba1b68f7a03f2383c964bec18, Git blobe2447601402bc09e7a46038241e84bc19f86c900, independently bound to target head/path using Git Contents JSON/base64 and Git blob verification.
- EVERY complete-module byte outside keywordExpression is identical. Both full snapshots are included for audit. The accompanying source-bindings.json names the exact registered-consumer imports. This projection claim is deliberately narrower than executing all source/dependencies from the external PR tree.

The production source runner compiled the namespace-visible inputs. The diagnostic checked the complete active module hash at entry and after normal stop. Distinct observed query matrices also discriminate baseline/raw behavior from both the external expansion and an NFC-index implementation; no source function was mocked or rewritten. No product files or existing branches were changed by the diagnostic.

## Runs and controls

Runtime: Node26.13.0, SQLite3.54.0, ICU78.3, Unicode17.0. One source-owned Vitest worker. Owned cleared-environment/network-unshared proof namespace; fresh separate fictional store for each phase; qualified physical dependencies. Same12667-byte script, SHA256 b174fc4b175993ba0e79c9339df0f887a93a4ad393626936ff40feaa0c662c79, executed ONCE per phase with no retries.

- Base: exit0, wrapper109.014s, test3.798s.
- External: exit1, wrapper110.364s, test3.730s. Only EXISTING_REVIEW_P2_KOREAN_LITERAL_RETENTION and EXACT_MIXED_RETENTION/all, /phrase failed. This red result is witness evidence, never a passing product verdict.
- Each phase completed14 searches, five exact lookups, one complete nine-cell Greek mode/form matrix and terminal receipt. All five source hashes are identical between phases and unchanged within each phase; bodies, revisions, citations and original snippet slices held.
- Greek any-mode control retains all three Greek rows for the exact mixed query in BOTH phases. ASCII all/phrase/any returns its sole control; unrelated query returns none. All rows remain valid and exactly lookup-readable; coverage is complete and index ready/nonlagging. Predicted sets are independently literal, not generated from production normalization.
- Every captured service stop was awaited, terminal markers confirm workers stopped and source/module hashes unchanged, and the full source-owned runner completed its teardown. Runtime-only fixture was preserved unchanged outside compiler inputs after both jobs ended; no compiler exclusion or tracked test change.

Actual command shape, with each complete module separately read-only mounted at the production owner path:

`H21_MIXED_PHASE=base node scripts/run-vitest.mjs extensions/knowledge/src/h21-pr195092-mixed.proof.test.ts --maxWorkers=1`

`H21_MIXED_PHASE=external node scripts/run-vitest.mjs extensions/knowledge/src/h21-pr195092-mixed.proof.test.ts --maxWorkers=1`

The .test.ts.txt artifact is staged unchanged at that temporary proof-only test path. Do not replace the source-owned wrapper with raw Vitest or bypass guards. Source lookup/SDK/fixture prerequisite failure is not this behavior witness. No build/install, policy or configuration relaxation was used for these two runs.

## Artifacts and remaining work

- registered-diagnostic.test.ts.txt: complete unchanged driver.
- observations.json: actual matrices, five input hashes and exact attribution/limits.
- base-terminal.txt / external-terminal.txt: complete substantive query/results/assertions and runner closeout. Sanitization removes ANSI and unrelated static sqlite-test-lifecycle inventory lines only; no behavioral result/assertion is removed. Original raw log hashes remain in observations.json provenance.
- owner-before.ts.txt / owner-external.ts.txt and source-bindings.json: complete immutable source and caller identity.
- manifest.json: bytes/SHA256 of every artifact.

This evidence supports the existing owner/reviewer repair. The existing shipped-entry proof request and other review requirements remain open; no re-review was requested and no source branch was edited. No actual user memories, credentials, authentication logs, private endpoints or customer data are included.
