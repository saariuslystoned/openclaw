# H12 feature, managed-custody and shutdown evidence mapping

**The feature and canonical managed-custody observations are accepted as bounded evidence. The original full test remains exit1. Application-level graceful-drain provenance and absence of escalation are unproved; no whole-test-green claim is made.**

Exact head: `2f3f470f17424a40e86f8beaafd06b422dec8d2c`. Frozen corrected fixture:29743 bytes, SHA256 `9473a8a0ffa50dda2dc05fa6b8c88588af8639a6050f09192581aac6802c83df`. Actual run:129.547s, exit1, watchdogfalse, source/fixture unchanged. Preserve `terminal.txt` and `observations.json` exactly as failed-run evidence; this adjudication does not rewrite them into a green test.

| Requirement / claim | Authoritative evidence | Disposition |
| --- | --- | --- |
| Real owning Gateway and caller | Built exact-head CLI; normal source-owned compiled-owner preflight; real readyz response; authenticated operator store/status/ontology calls | PROVEN within the isolated test profile |
| Image→visible→image behavior | Six published/Git-committed action receipts;12 exact connection sets; outgoing0→1→0/backlinks1→2→1; both opposite controls | PROVEN |
| Original bytes, identities, revisions | Four distinct actual IDs;14 record/raw-byte observations; three controls retain hash/revision1; diagram revisions1→2→3 | PROVEN |
| All owned commands settled | 55 successful child-command receipts:54 built-CLI calls + one EMPTY Registry fixture child; no uncertain content write replay | PROVEN |
| Process/output/tree custody | Actual started/PID/exit/close, successful canonical stop and fulfilled spawn cleanup; owning source joins completion AND extinction before returningtrue | PROVEN for canonical managed-stop contract; not proof that no escalation occurred |
| Listener / cooperative claim | Successful owned listener rebind and close; claim release fulfilled | PROVEN |
| Runner generation/source closure | Wrapper terminal input/output verification; selected own generation absent after wrapper; source and fixture unchanged | PROVEN |
| Numeric0/no-signal as universal clean-exit contract | Exact production source explicitly permits successful settled POSIX CLI termination by self-SIGTERM | REJECT as a universal oracle; actual historical assertion failure remains |
| This run used that settled self-SIGTERM path | No producer-disposition/exit-origin field was retained; other signal paths exist | NOT PROVEN |
| Application-level graceful server drain | No retained server-drained disposition; fixture conflates a signal result and its drain-wait timeout before stop | NOT PROVEN |
| Original full test green | Actual code1/normalExitfalse/proofCompletefalse/cleanupOKfalse | CONTRADICTED; retain red |
| CI / native review / merge ready | Existing installation-quota/admin-rerun failure and native hold remain; no new review requested | HELD |

## Exact source and receipt fidelity

The received shutdown packet11603B SHA256 `600fe6401c0d60021422b5d33f766c998bff9c118494e3b333e459c51c86a37c` contains a6899B memo SHA256 `1c84d0504cc67d8043af9cfc1f8db826df4bab1f94f286fe060315a0a8a4a763` and24 complete immutable source bindings. Root independently verified every full byte count/SHA256/Git blob OID against this head, then inspected the owning call path and closure code. The prior fixture and runner qualification independently bound84 complete files. `shutdown-source-bindings.json` holds the additional source record; it grants no new runtime authority.

`dist/index.js` maps to `src/index.ts` at [tsdown.config.ts:552](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/tsdown.config.ts#L552), not `src/entry.ts`. The actual executable path enters CLI finalization at [src/index.ts:154–249](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/src/index.ts#L154). No unobserved openclaw.mjs/entry.ts launcher is attributed to the run.

[one-shot-exit.ts:31–81](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/src/cli/one-shot-exit.ts#L31) joins CLI work, disposers and finalizers; [109–148](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/src/cli/one-shot-exit.ts#L109) allows the settled POSIX watchdog to re-raise SIGTERM for a successful outcome. [run-loop-cleanup.ts:164–192](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/src/cli/gateway-cli/run-loop-cleanup.ts#L164) conditions that settled-exit path on its cleanup contract. This makes a universal zero-only oracle unsound, while proving only a possible production path—not which path this retained run took.

[openclaw-test-process.ts:113–143](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/test/helpers/openclaw-test-process.ts#L113) returns stop:true only after completion and extinction both fulfill and the adapter is disposed. [service-child-relay-host.ts:315–388](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/src/process/supervisor/service-child-relay-host.ts#L315) requires closing/lineage/owner receipts and the selected native extinction certificate, and can preserve a fallback root signal result. The canonical instance [1047–1113](https://github.com/openclaw/openclaw/blob/2f3f470f17424a40e86f8beaafd06b422dec8d2c/test/helpers/openclaw-test-instance.ts#L1047) accepts that verified stop/closure contract without a numeric-zero gate. This supports the observed custody facts. It does not certify no escalation or every server close step.

The source's loop clean-stop reasoning and OS signal representation are separate. Root's false outer watchdog flag does not rule out an internal settled-exit watchdog. No raw CLI/Gateway/auth log, credential state, new runtime reader, process kill or security/configuration change was used to qualify the evidence.

## Accepted bounded disposition

Accept the retained **feature and canonical managed-custody observations as bounded evidence**. Reject the inference that null/SIGTERM alone proves a Knowledge or shutdown defect. Preserve the failed test and the unobserved application-drain column; do not call the whole proof green or claim this run took the settled self-signal branch.

If the admission contract requires positively witnessed application drain, keep that gate open. If its closure requirement is the canonical managed-stop contract, the source-bound custody receipts support that narrower closure statement, with the graceful-drain limit explicit. The accepted scope is the feature observations and canonical managed-custody contract. Application-level graceful drain remains explicitly outside the proven observations; this is not a fixture relaxation or whole-test-green verdict.

No full-journey rerun is recommended merely to change the oracle. A producer disposition was not exported by this fixture and cannot be invented retroactively. No further Gateway launch, new reader or oracle-only replay occurred. External review still adjudicates its original behavior-proof hold. Existing H5 proof is a different head and supplies no H12 runtime clearance.
