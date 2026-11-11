# Reaction conversations on the clean November 8 pin

Implements #876 on exact upstream `ee2d00b13f786f568baa4c4c33376767e5c6f666`, not moving main. This successor preserves prior source/evidence without inheriting its review clearance.

- Discord and Signal default to passive behavior. Account capability `reaction-conversations` enables ordinary, command-unauthorized room-event turns. Native reaction target and transport occurrence stay separate.
- Existing channel ingress owns replay/restart dedupe; worker-backed plugin keyed storage owns reply receipts. Confirmed receipts dedupe, identity collisions reject, capacity rejects new keys without eviction, interrupted/uncertain claims never automatically resend. Only proven pre-send refusal can retry.
- Current actor/channel/session/plugin/run authority remains required at final effect, including queued/prepared/retried work. Reactions confer no approval or execution authority. Reaction-only output sends no text.
- Retained installed fixes: Gateway workspace-aware inventory, plugin tool final-fetch authority, cold MCP provider-review guard and pending-preparation regression. Setup/Doctor and incognito fixes already exist in the pin. Four temporary diagnostic commits are omitted.
- No unrelated upstream fixture/runtime repairs, global cap/env/concurrency changes, dependency changes, production state changes, public SDK additions or schema relabeling. Source schema constants remain state 39 / agent 41. Packaging, artifact admission and rollback remain separate gates.

## Focused source validation

- 128 product/sibling tests PASS, including all 43 CLI authority cases.
- 53 retained-fix and pin-owned setup/incognito cases PASS across six files; 37 additional passive/approval/prefix cases PASS after preserving the passive Signal parser.
- Core/extensions and affected test type leaves PASS; scoped lint/format/export synchronization PASS. Exact feature allocation: 2,278 net test LF; shared scalar unchanged.
- Exact-base SDK comparison: identical public names and all per-entrypoint statistics, 162 entrypoints / 3,876 exports / 2,237 callables, one wildcard reexport. Default absolute budget FAILS (limits 3,865 / 2,235 / zero). No cap/env/ignore changes or waiver; owner adjudication remains required.
- Final build, disposable shipped Gateway integration, exact-head hosted CI and comprehensive review remain required; source test success alone is not acceptance.

Author simplification: retain plugin-owned policy and transport adapters, existing ingress and keyed-store owners; no new manager/schema/public subpath. Signal bounded reaction checks belong only to the opted-in adapter, preserving the pin's passive parser. Pin-owned inventory import and retention semantics are preserved instead of importing later upstream lifetime changes. Test growth protects distinct replay/restart, uncertainty/collision/capacity, final-authority and real Gateway boundaries.

No installation, production send, merge or deployment is performed by this source lane.
