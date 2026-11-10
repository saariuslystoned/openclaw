# Reaction conversation proof

## Independent product proof continuation (Turn 5)

Starting published source24b787e9ea2fc70ba31d15c8c8598525c06ceef4;
immutable base d59f00281eb02167a86b57c42f04b2b59ed203fe. This checkpoint
supersedes the independent-proof gaps below, NOT the fork promotion gates.

- `test/reaction-conversations.gateway.e2e.test.ts` starts the shipped compiled
  CLI through the maintained QA Gateway child with empty disposable state and
  loopback Discord WebSocket/REST, Signal SSE/native JSON-RPC and OpenAI Responses
  fixtures. No dispatcher, agent, message tool, authority or state owner is mocked.
  Both add/remove paths reach the real agent/tool/native effect, with exact native
  target/account and original target text (Signal text seeded via ordinary ingress).
  Races, restart/replay/history, denied/self/bot events, intentional silence,
  opt-in absent/empty, source stop during awaited model work and queued Discord429
  retry are exercised. External protocol peers are synthetic, not live delivery.
- The stronger chain reproduced a real missing safeguard: Discord's idempotent
  transport retry hid an accepted-but-response-lost PUT behind another PUT. The
  plugin's opted-in reaction mutation now selects the existing strict retry policy,
  retaining pre-connect/rate-limit retry and unchanged passive-account defaults.
  The chain verifies an uncertain tool receipt and no replay after restart; focused
  add/remove tests independently verify opted-in vs absent/empty behavior.
- Model inventory contains only `message`, and the disposable Gateway's exec
  approval snapshot is unchanged. No reaction executes commands, accepts worker
  results, grants approval or clears a gate. These tests do not authorize deployment.
- UNIX sibling failure is an inherited environment refusal, not a reaction-source
  regression: baseline and24b socket admission source bytes are identical. Executing
  the exact baseline boundary reproduces ancestor-ACL rejection; process-only
  `TMPDIR=/private/tmp` uses a safe disposable root without altering ACLs/guards.
  All70 affected native/container/UNIX sibling cases pass. Shared fixture now
  surfaces pre-preparation rejection directly rather than waiting120s; assertions
  and timeout budgets are unchanged. Baseline boundary execution is not a whole
  baseline test suite claim.
- Maintained SDK comparison d59f→24b completed EXIT=0 after438s renders (previous
  180s timeout retained). Four added exports, no removals, digest7c97a093; reachable
  surface requires normal review, not self-approval. A new final source commit must
  bind renewed API evidence to its exact head.

Coordinator proof retains all original failed logs and exact commands/exits.
Latest precommit full protocol test:23.7s test time,37.29s wrapper with prepared
runtime, EXIT=0 (earlier fresh runtime build included164.98s wrapper). Focused
siblings:59 Discord send cases,10 durable cases and70 native Signal cases pass.
New test growth has a dedicated651-line regression allocation,
no shared scalar/API baseline/per-file cap increase. Fresh final-head checks,
source publication and promotion review/CI are recorded separately by coordinator.
No fork PR, merge, runtime installation or production activation is claimed.

## Current fork-only continuation

This packet is source preparation, not accepted delivery. Earlier results below
are historical. Both channels now require explicit account-level
`capabilities: ["reaction-conversations"]`; omission/empty preserves passive
notifications. The initially proposed boolean field hit the enforced config
surface cap at commit preflight. It was removed in favor of this maintained
capability seam; no budget/baseline was raised or hook bypassed.
Occurrences remain distinct from native targets, and opted-in Signal observations
never enter approval resolution. No task or approval service is mutated.

Current focused proof: 16 cases pass across the two durable suites and REST
authority siblings. The Discord reaction source callback, real sender, queued POST
and final REST fetch are exercised with admitted channel metadata and dispatch
scheduling injected. Revocation before queue release produces zero extra fetches.
Removing the source authority binding and final-send guard makes that exact test
fail (the revoked send resolves). Both red and green results are retained by the
coordinator. This is not a full Gateway/model execution claim.

Signal proof now traverses durable ingress, ordinary dispatch, channel threading,
actual action adapter, sender, native RPC client and disposable loopback HTTP.
It verifies original target/account/author and no repeat sends after replay/reopen.
Native preparation tests also preserve an inherited incoming assertion across an
await and reject revocation before HTTP I/O. Provider/model fixtures do not prove
live phone delivery or a real-agent Gateway run; that requested proof remains open.
Receipt tests preserve confirmed and uncertain data at capacity/reopen, refuse a
third key without transport, and refuse cached confirmation to expired authority.
Existing schema/options are unchanged; no receipt deletion/rotation is recovery.
Ordinary text remains available at the explicit 5,000-row limit.

Current local checks: full build EXIT=0; production core and extension types
EXIT=0; extension-test types EXIT=0; touched source lint and generated channel
metadata validation EXIT=0; max-lines and test-line ratchets EXIT=0. The latter
uses the documented per-change allocation for 306 net additional regression lines,
not a shared scalar/API/cap baseline change. A broad focused sibling command
completed prefix (14), message-tool completion (68), Discord (63) and durable
integration (10) shards, but then timed out in the unchanged Signal UNIX
preparation test. That command is NOT a pass; its log/failure is retained. The
UNIX test, native client and shared transport test helper are unchanged from the
provisioned base. The default root typecheck was the wrong all-project entrypoint
(JSX not enabled); supported production/extension-test lanes above pass. SDK API
rendering, full Gateway proof, CI and fresh independent reviews remain pending.

Publication gate: the verified fork main is ancestor `c3eab7ef86637474d5de3a702bf7d83a643ed9bf`,
but the provisioned source already contains 27,089 additional commits. A PR to that
main would propose 64,276 files, not this feature. No main sync or alternative base
branch is implicitly authorized. Current signed Saari native target registry also
does not enroll this fork. Resolve a qualified narrow fork PR/review surface before
claiming CI/review delivery. No upstream resubmission or service setup is included.

## Boundaries

- Discord: gateway session/sequence identity survives resume, separates fresh sessions and omits history lacking an occurrence; the existing durable queue feeds authorized add/remove listeners, original target lookup, native conversation routing and ordinary dispatch. Replacement monitor and concurrent replay do not start duplicate turns.
- Signal: real durable ingress and event handler reach ordinary dispatch for add/remove, including group scope inherited from `dataMessage`. Original permitted target text and coordinator routing are retained. Denied groups, self and sync/history do not dispatch. Unsafe timestamps and oversized reaction context are dropped.
- Outbound: actual Discord/Signal action adapters, injected provider transports and real worker-backed receipt stores prove one send under concurrent/reopened keys, immutable target binding, confirmed transport results, uncertain timeout containment, interrupted claims and proven-not-sent retries.
- Conversation observations use `room_event`, not executable command input. They preserve normal tool/task/approval gates, permit deliberate silence and do not produce redundant no-answer text. Existing message-tool completion tests cover explicitly final successful reactions and rejection of dry-run, failed, unrelated, removal and nonterminal outcomes.

## Reproduction and checks

The original Signal event-handler boundary dispatched neither add nor removal. A focused red/green reproduction was recorded before implementing the path. The final tests exercise the deeper durable ingress/ordinary-dispatch boundary; redundant shallow add/remove tests were removed during simplification. Model/provider results are injected, not access, routing, ingress, context assembly, dispatch or receipt storage. Fixture broker/config corrections are setup evidence, not product proof.

Focused commands:

```sh
pnpm test extensions/discord/src/monitor/reaction-conversation.test.ts --maxWorkers=1
pnpm test extensions/signal/src/signal-ingress.reaction-conversation.test.ts --maxWorkers=1
pnpm test extensions/discord/src/internal/gateway.test.ts --maxWorkers=1
pnpm test extensions/signal/src/monitor/event-handler.inbound-context.test.ts --maxWorkers=1
pnpm tsgo:core
pnpm tsgo:extensions
pnpm tsgo:extensions:test
pnpm build
```

Local source candidate (base `d59f00281eb02167a86b57c42f04b2b59ed203fe`): full build exit 0; core, production extension and extension-test typechecks exit 0; SDK import/export inventory exit 0. The SDK API diff needs committed refs and remains pending (an initial invocation without refs exited 2, not a pass).

Four durable incoming/outgoing integration cases pass. Discord proof now uses the actual production message-handler composition and listener admission, not a test copy of its dispatcher registration. Gateway occurrence tests (22), existing message-tool completion/negative controls (68), prompt-prefix tests (14), and Discord ingress-recovery siblings pass. Cold compiler preparation adds command wall time. An earlier candidate shard failed because a fixture reopened the Signal receipt namespace with incompatible options; the fixture was corrected to match the production options without erasing state or weakening assertions. The affected receipt/restart test passes. Historical failure is retained in the coordinating proof trail.

Published as openclaw/openclaw#195021, related issue #195017. Comprehensive Spark-2 review of base `d59f00281eb02167a86b57c42f04b2b59ed203fe` / source `ee89da0872a7c92a09324da593e2fd2c8cbbc7d2` completed clean (0 findings), exact-tuple qualified, comprehensive P3/native and applied P3. This is historical evidence, not clearance for later revisions.

Initial ready-PR CI exposed two in-scope proof defects: the CLI integration fixture registered channel actions without initializing their plugin-instance runtime, and net regression-test growth lacked its dedicated allocation. The fixture now installs the real registry-owned runtime in the same plugin instance; the real MCP/provider-authority suite passes 43/43 with existing abort/revocation assertions unchanged. The dedicated 678-line allocation covers this change's justified ingress/receipt/replay/identity regressions, without editing the shared scalar. Ratchet, lint and format pass. Original failures and the failed outside-instance fixture repair are retained in the coordinating proof trail. Test time is under five seconds per new integration file; initial CI's affected authority file took about ten seconds. Broad CI job seconds include compilation/setup and are not a per-test cost.

Final-head CI/native review and SDK API rendering remain pending; no overall completion or live delivery is claimed.

## Simplification and limits

Author simplification pass: retained the smallest complete cross-channel slice, rather than an outbound-only stage that would not address missing incoming turns. Consolidated message/reaction admission under one lifecycle function and removed the test's parallel dispatcher wiring; each boundary test protects a distinct transport, replay or receipt failure. Necessary growth is the two plugin adapters and their boundary tests, plus only shared typed context/receipt contracts in core. No historical coordination receipt implementation was transplanted. The new code reuses ordinary channel turn admission, native route selection, existing ingress tombstones, the message tool's final-reaction completion and the plugin-state worker. The obsolete Signal plaintext-event formatter was removed. The public seams are a typed reaction fact and a receipt operation on existing SDK subpaths, not new tools or services.

Receipt state is bounded to 5,000 retained rows per plugin namespace and rejects new entries instead of evicting dedupe history. Uncertain/claimed operations do not automatically resend or become confirmed. Existing direct unkeyed API calls remain non-durable; conversational message-tool calls carry stable idempotency keys. Incoming replay protection retains the existing ingress retention contract.

No test proves live phone/customer delivery or production activation. No reaction is worker-result acceptance, approval, gate clearance or destructive-action authority. No self-merge or runtime deployment is included.
