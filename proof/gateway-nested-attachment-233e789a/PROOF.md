# Local XPS beta and exact-H38 Gateway proof

Result: **PASS for actual Gateway download behavior and canonical managed custody. All proof Gateways are stopped.** No product source changed.

## Runtime identity

- Local Linux/aarch64; Node26.13.0, SQLite3.54.0.
- Official npm beta at observation: **2026.11.5-beta.1**, published2026-11-04. Package SHA256 `a98511acc5a1fe711b561b2d5adce322b71fd3f44e855d2c5c354d54f6f9a043`; registry SHA512 and SHA1 matched. Actual CLI reports `OpenClaw 2026.11.5-beta.1 (bc061f9)`. GitHub-verified signed release tag and package build metadata agree on `bc061f935bfd79ad09e3e98c6df9f2e8f1e28bea`. npm provenance statements' subject digests match; full Sigstore trust-chain validation is not claimed.
- Beta installed only at `versions/2026.11.5-beta.1`, with a task-owned dependency cache and lock. No global install, system profile, service or account change. `current` selects this inert installation; `rollback.json` records that this fresh install replaced no previous release.
- H38 used a **separate full matching source runtime** at `233e789a02100b6c4f78afb6fe50c393f8d4402d`, package version2026.11.1. No newer first-party plugin was overlaid on the beta. Exact-source runtime build passed149.836s; both stamps report the exact head and clean inputs. `candidate-build-identity.json` binds entrypoint/stamps/build-info. Fresh PR readback still matches233e/base0566/body67bc, OPEN/unmerged.

## Actual behavior

The repository's normal `scripts/run-vitest.mjs` runner prepared, verified, lent, joined and disposed a current-source worker generation. The fixture verified selected loader-free native custody owner, its generation containment and manifest hashes before setup. Real built CLI calls authenticated to the **running Gateway** via `plugins.sessionAction`. An actual Registry owner child provisioned only an empty private store and exited before Gateway startup; all upload/publication/query content operations used the Gateway. No synthetic host authority, direct-module download, real archive, model or browser interaction is substituted.

One fictional74-byte Prism source and four published fictional records were used. An external portable-record edit changed only top-level evidence plus coherent revision/date, preserving nested identity evidence, body, source and controls.

| Stage | Top-level evidence | Revision | Subject download | Ordinary control | Unrelated record |
| --- | ---: | ---: | --- | --- | --- |
| Canonical | 1 | 1 | exact74 bytes | exact74 bytes | attachment and evidence reads refused |
| Portable nested-only | 0 | 2 | exact74 bytes | exact74 bytes | attachment and evidence reads refused |
| Restored top-level | 1 | 3 | exact74 bytes | exact74 bytes | attachment and evidence reads refused |

Source SHA256 throughout: `dd063402beaa8dbc0358074598c471d0aaff82e0543acfca8277b279caf9e914`. Records remained valid, nested citations verified, body hash constant, and ordinary/unrelated/candidate record bytes unchanged. The unrelated record was valid with zero evidence. Successful byte comparisons occurred before and after each pair of denied calls. All six denials returned CLI exit1 and the public generic Gateway plugin-action error. The Gateway intentionally masks the handler's detailed exception; the internal exception reason is not claimed from the remote response. The exact source's selector/refusal path and error boundary are separately inspected.

Successful candidate run: **exit0, 179.178s, 1 test passed, 46 owned commands, watchdog false**. Three full source stages and six negative controls are independently reconciled in `INDEPENDENT-ACCEPTANCE.json`; all64 source bindings and final executed fixture hash independently matched.

## Lifecycle and cleanup

Beta lifecycle passed separately in attempt03: real readiness/authenticated health on private port8024, exit0/close/owner join/listener closure/claim release; same-case restart on8032 and the same successful teardown. These passed steps were retained without repeating them during the final candidate-only repair. Candidate epochs used separate disposable cases, one Gateway at a time. Final successful candidate target: `127.0.0.1:3024` in its private network namespace, command PID487 in that PID namespace / host PID945418, supervised by owned process group943970. All are now closed; this is not a retained endpoint.

Final candidate teardown observed terminal **null/SIGTERM after10480ms**, before owner-stop join. `stop:true`, exit/close, fulfilled spawn custody, listener rebind/close and claim release all passed. The normal runner disposed its generation; the outer wrapper exited0. All exact owned leaders from the attempts are gone; no process retains a task-root cwd. Temporary case/HOME/config/auth/log/state files and private networking disappeared with the owned tmpfs/namespace. The untracked proof fixture was relocated unchanged after wrapper termination; tracked source remains clean233e.

Cleanup acceptance is **canonical process/output/tree/listener/claim custody**, not a numeric-zero-only rule. Application-level graceful drain, actual settled self-SIGTERM branch and absence of escalation remain **UNPROVEN**. H12's historical129.547s/exit1/proofComplete:false/cleanupOK:false run and strict fixture remain unchanged. This result does not recolor it.

No service is left standing because this finite proof has finished. The verified beta package/cache, exact-source build and sanitized evidence are retained as useful inert inputs for later assigned proof. No daemon/autostart or shared/personal cleanup was introduced.

## Commands, artifacts and limits

- Beta version check: `node node_modules/openclaw/openclaw.mjs --version`, inside the cleared-environment task namespace.
- Candidate build: package-owned `node --import ./scripts/tsx.mjs scripts/build-all.mts runtime`, with source-owned lock/SHA512-pinned native assets prepared before its network-isolated build.
- Proof: `node scripts/run-vitest.mjs extensions/knowledge/src/h38-beta-gateway.proof.test.ts --maxWorkers=1`, with the frozen executed fixture, normal runtime flags, private tmpfs cases, cleared environment and network isolation. The private operator receipt retains the exact namespace command. This export records its invocation and exact-source/owner/cleanup observations; host paths are omitted. Place `empty-owner.mjs` and `source-bindings.json` at `/proof/artifacts/empty-owner/gateway-proof.mjs` and `/proof/artifacts/empty-owner/source-bindings.json` when reproducing the fixture in an equivalent admitted namespace.
- Final fixture SHA256: `def927a3ed0cd5db2ca3f2c2f96d53f688709ae4da98f79c57f66cf3a4609ce6`.
- Actual events: `gateway-events.jsonl`; final result: `candidate-run.json`; independent reconciliation: `INDEPENDENT-ACCEPTANCE.json`; beta lifecycle: `beta-lifecycle.jsonl`.
- Earlier setup/observer failures remain under `epochs/`. Attempt01 lost ANSI-prefixed diagnostics before any Gateway launch. Attempt02 established that older beta lacks the newer-main writer metadata field, with cleanup passing. Attempt03 proved both beta epochs but its whole run failed because the negative observer expected private store text rather than the public Gateway error. Attempt04 repaired only that observer, added evidence-free unrelated-record and before/after positive controls, and passed. A final candidate-only run added two port/PID observation events required by the task and passed again; the prior passing run is preserved unchanged in attempt04. No product repair or guard bypass occurred.
- This is Gateway API proof for a small single-page source. It does not claim browser/native-save completion, cancellation, multi-page behavior, real-model behavior, a security audit or a new base-red Gateway replay. Existing historical base-red evidence retains its original source binding.

This text/fixture/event bundle is prepared and unpublished. Exact-head review and human merge gates remain; no review or publication outcome is claimed.
