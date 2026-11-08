# Signal quoted native mentions

Issue: https://github.com/openclaw/openclaw/issues/195074

Base: `c6f36bdf5dd95de85a1439ba9610dd5f496a8d61` (fresh upstream main). Branch: `codex/signal-quote-mentions-20261108`.

## Behavior and ownership

Native Signal quotes contain their own mention metadata. The existing current-message renderer understood the metadata, but quote extraction trimmed and forwarded only `quote.text`, leaving U+FFFC in model-visible quoted context and dropping the recipient. The fix adds the existing SignalMention type to `quote.mentions` and calls the existing renderSignalMentions before trimming and the existing quote visibility filter. No new parser, renderer, policy, SDK contract, state, or current-message target convention.

Actual supported fictional quote text has two leading spaces, a non-BMP compass character and U+FFFC at UTF16 offset9/length1. Two native inputs differ only in quote.mentions[0].name and UUID. Quote author is the fictional phone+15550002222, not a UUID, to keep the independent author-normalization issue out of this regression.

Base formatted quote body: `Ask 🧭 [U+FFFC] to prepare the fictional report.` Both recipient inputs produce identical complete finalized contexts and prefixes. Candidate body A: `Ask 🧭 @c3456789-01bc-4def-9012-3456789abcde to prepare the fictional report.` Candidate B retains its distinct `@d4567890-12cd-4efa-a123-456789abcdef`. Sender remains+15550002222. The ordering proves hydration uses original native offsets before trimming.

Protocol references: signal-cli pin `48a0a5e90cb0c36153f0276c0affff090e588290`, [JsonQuote](https://github.com/AsamK/signal-cli/blob/48a0a5e90cb0c36153f0276c0affff090e588290/src/main/java/org/asamk/signal/json/JsonQuote.java), [JsonMention](https://github.com/AsamK/signal-cli/blob/48a0a5e90cb0c36153f0276c0affff090e588290/src/main/java/org/asamk/signal/json/JsonMention.java), [native UTF16 quote-mention format](https://github.com/AsamK/signal-cli/blob/48a0a5e90cb0c36153f0276c0affff090e588290/man/signal-cli.1.adoc). RecipientAddress permits legacy name equal to UUID when no phone exists.

## Runtime proof

The frozen disposable reproduction was run through public monitorSignalProvider, serialized native SSE, real durable ingress, finalized context, production buildInboundUserContextPrefix, actual native block delivery and final planner→adapter HTTP dispatch. Tool threading and actual CLI reply-route preparation are checked on that captured context. Model dispatch and core session recording are substituted; no sender/context/formatter failure is supplied.

Base: exit1,5passed/1intended failed,99.91seconds. Candidate: same exact fixture/config-file bytes and eight notification payloads, exit0,6passed,52.20seconds. Actual runtime config differs solely in the claimed ephemeral loopback port (62000 versus32024); account/access/visibility/reply settings are equal. This is explicit endpoint variance, not byte-identical runtime configuration.

Current native mentions, literal quoted UUID text, denied-quote visibility, ordinary quote content, native current block/final targets, tool/CLI current targets and idle receive cancellation pass. The six opposite complete contexts/prefixes, all eight native wire arrays and cancellation receipt are unchanged between base and candidate. Only the two native quoted bodies change.

Committed regression keeps those eight stimuli and independent expected bodies/controls. It removes disposable output writes and fixture self-checks, folding collection into the primary regression: five tests. Its real durable ingress requires the supported isolated host-broker lane; exactly one test registration is added. Existing inbound-context and mention-gating owner suites are reused. No duplicate helper-only field-copy regression is added.

Commands run in secretless no-network bwrap, fictional state and loopback only, Node26.13.0, pinned pnpm12.15 with frozen lockfile/ignore-scripts and owned dependencies. Pinned official Bun is checksum/architecture/revision verified before static checks.

```sh
node scripts/run-vitest.mjs --config .openclaw/tmp/signal-quote-mentions-20261108/vitest.config.ts .openclaw/tmp/signal-quote-mentions-20261108/quote-mentions.test.ts --maxWorkers=1
node scripts/run-vitest.mjs test/signal-quote-mentions.integration.test.ts extensions/signal/src/monitor/event-handler.inbound-context.test.ts extensions/signal/src/monitor/event-handler.mention-gating.test.ts --maxWorkers=1
```

Focused maintained run: committed runtime5/5 plus existing owner41/41, exit0,174.46seconds across2shards (root106.75s, Signal64.50s). Root-only final rerun after fixture-only braces/type narrowing passed5/5,exit0,103.61seconds file duration/105.79seconds wrapper; the unchanged41owner cases are reused. Initial fixture lint/type diagnostics are retained in local proof: missing braces and unchecked array access, corrected without casts, suppressions or weaker assertions.

Targeted maintained run-tsgo with a task-local config extending root compiler options: exit0. Maintained type-aware run-oxlint on both production files, root regression and routing:0warnings/0errors. Maintained source/test/docs formatter: exit0, pinned-Bun/oxfmt parity.

Exact allocation457 equals new test LF growth457; shared scalar unchanged. Staged ratchet against the exact base reports6574813 versus ceiling6574797, inherited overage16. Subtracting equal457line growth/grant gives base6574356 versus base ceiling6574340. No unrelated test deletion or surplus grant masks that inherited debt; coordinator adjudication is pending.

The simplify pass retains one existing renderer and visibility owner, no new production seam or duplicate helper-only regression. Production delta is+9/-1 across2files; justified test growth is457LF. The new runtime regression executes in under5seconds; wrapper wall time is dominated by compiler/import setup. This is the smallest permitted real-monitor composition covering user-visible quoted meaning plus native/current-target/visibility/cancellation boundaries. CI seconds and the real journey are not claimed.

## Limits and gates

This is fictional native protocol integration proof. No actual Signal service/account/device, live Gateway, real model/agent journey or phone-visible delivery was used. Final planner→adapter wire proof does not establish core durable outbox persistence. A real shipped Signal→Gateway→real agent/model journey remains external proof before merge; this isolated source assignment does not authorize it. Packaging, other platforms and CI breadth remain separate checks.

Quote ID, author identity normalization and ReplyChain are outside this change; the fresh-main scalar quote contract and current native reply targets are preserved. No existing quote or reaction branch was stacked, edited or cherry-picked. No new PR is created by this work. Publication goes through the existing qualified shared publisher; prepared evidence is not an enqueued item or merge approval.

## Source content identity

Base c6f36bdf5dd95de85a1439ba9610dd5f496a8d61; the eventual content commit is the commit containing this proof.

| Path                                                             | SHA256                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| extensions/signal/src/monitor/event-handler.types.ts             | `64c75681e5f0be5fc3d82ece5605a9d2d7bf068f4c488b76888fdde185104d25` |
| extensions/signal/src/monitor/inbound-context.ts                 | `63428f69d991aece2e6bd367276bea7a711d6be5deb3023d2493c891af91d9af` |
| test/signal-quote-mentions.integration.test.ts                   | `239555efc55e2e1677765d2a9f0515df1b5b435cd9ca7c103f8edb85cb398542` |
| test/vitest/vitest.tooling-isolated-paths.mjs                    | `3e23bc2a9b242a0820562233d3fa307d776d0633269e98d8e39161c50f3a5eb2` |
| config/test-lines-allocations/signal-quote-mentions-20261108.txt | `2a4ad92944d3d0f0b06e2fda28ff08ed8bbf33daf766a889339afa47b3b95440` |
