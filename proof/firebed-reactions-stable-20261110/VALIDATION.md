# Stable reaction conversations — #876

Base: OpenClaw v2026.11.3, `847611dcaa3bf0e2783335f961dd1fd0580e4d9f`.
Target: fork branch `team-gateway-876-v2026.11.3`; task branch `ridge/firebed-reactions-stable-20261110`.

## Scope and owners

Adds opt-in `reaction-conversations` capability for Discord and Signal. Unset/disabled remains passive; stable Signal question/approval handling remains unchanged. Opted-in add/remove observations are ordinary room events, never approval or task acceptance. Native target and ingress occurrence remain distinct. Existing channel ingress, final source completion, Discord REST authority and worker-backed plugin state remain authoritative.

Durable outbound receipt rows use the existing plugin keyed store, bounded to 5000 keys with reject-new capacity. Keys bind account/target/reaction identity. Confirmed receipts dedupe; interrupted/uncertain sends never blindly retry. Only a proven pre-transport authority refusal is retryable. No new database schema, public SDK entrypoint/export budget, dependency or release-version change. A local-only SDK runtime facade shares the receipt operation. Rollback disables the opt-in capability or restores the stable binary; receipt evidence remains untouched, with no automatic expiry/deletion.

## Local evidence

Commands run on Darwin arm64 / Node v26.11.1 using repository wrappers and isolated synthetic state. Source hashes and full logs retained with the source owner's local proof ledger; no private transcript or credentials are included here.

- `pnpm build`: exit0, 14m37 on runtime-identical dirty candidate. Current-source E2E preparation subsequently completed all build phases in 13m11 (no overlapping build); the command timeout interrupted collection, not its retained child, which completed the Gateway test. Source bytes match the committed candidate; only this validation summary and proof-output ignore policy were updated afterward.
- Core, extensions, extension-test and all four root-test type lanes: exit0 with explicit renewed receipts.
- Focused Discord/Signal reaction, durable ingress/recovery, gateway occurrence/resume, outbound revocation and passive Signal question/client tests: 70 passed across eight files, exit0.
- Shipped QA-child / real-agent / message-tool integration: prior run exit0; renewed current-source child reports 1/1 PASS after rebuilding the shipped runtime. Loopback synthetic Discord, Signal and model provider only. Checks default passive/opt-in, actors and native targets, replay/restart, durable completion, uncertainty, no approval effect and no reaction-only text sends. The outer collection command timed out during rebuild, so its exit is not misreported as zero; terminal child output and process settlement are retained separately.
- SDK budget/export synchronization: pass; 155 public entrypoints, 3761 exports, 2196 callables, zero public additions or budget changes.
- Scoped formatting and diff whitespace: pass.
- Scoped core/extension lint: pass; root fixture lint renewed with explicit exit0. Earlier exit137 coincided with the previous turn's hour-limit termination and is retained as failure history, not green evidence.

## Failure history and limits

Initial full build was interrupted while its compiler continued; coordinator later released only the specifically approved retained task lock after descendant settlement. Subsequent empty artifact-lock directory was not removed. No lock bypass or concurrent build was used. Test worker routing, old-base fixture imports and ingress fixture type defects were repaired. Early integration attempts incorrectly returned NO_REPLY to ordinary required-answer control turns; stable emitted its fallback response. The fixture now returns explicit synthetic control acknowledgments while preserving zero reaction-only text assertions and portable temporary-directory handling.

These are controlled integration results, not live phone, external API, production, deployment or human acceptance proof. Cold-import profile of dirty source was screening only and must be renewed on committed source.

## Publication and acceptance

Historical PR3 remains untouched. Final readiness requires actual successor PR source identity, terminal exact-source CI, and one comprehensive OpenClaw autoreview through P3 on the exact repository/PR/base/head tuple, with no unresolved P0/P1/P2 and documented P3 dispositions. Fork owner policy explicitly does not require native ClawSweeper; no App/enrollment/default operations are in scope. Current receipts and final source mapping belong in the successor PR and local task ledger. No self-merge or deployment; independent owner acceptance and guarded merge remain required.
