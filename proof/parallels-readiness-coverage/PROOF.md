# macOS smoke readiness coverage

This test-only change protects the existing readiness-before-reset contract. It
is not a product fix or proof of a live Parallels guest. The tests were derived
locally from public source; no remote patch or unreceived evidence archive was
applied.

## Source and boundary

Base: `08f98e29e816fb199b51e3c5c16e643f33fc55a5` in `openclaw/openclaw`.
The production `scripts/e2e/parallels/macos-smoke.ts` is unchanged (SHA-256
`18f593aae588c27c642f699f1ece19d1446a9da48a263dae9fbdcfb0583da55b`).

The existing `runSmoke`, `writeNodeFakePrlctl` and `fakePrlctlEnv` helpers run the
real CLI against external executable fixtures. Every attempted guest script
write is recorded before it is refused; the fixture does not decide whether the
owner is allowed to write. The three inputs cover transient exit 255, malformed
status-zero usernames, and persistent unavailability with no usable fallback.
Existing immediate-readiness and packaging tests remain intact.

A child-only `Date.now` preload reads the fixture clock. Fixed fictional command
durations cross the existing 45-second and 360-second windows without waiting.
Command subprocesses retain real clocks; the enclosing 780-second phase policy
is unchanged. No assertion copies the username regular expression, exact retry
counts, or polling schedule. Positive cases intentionally stop at a refused
reset upload; overall smoke success is not expected.

Execution used Linux arm64, Node 26.13.0, Vitest 5.0.5, tsx 4.23.15 and
`@openclaw/proc-safe` 0.4.2. Dependencies were reused read-only from an installation
with the identical lockfile. The source and dependencies were read-only in a
private PID/network/home namespace; only task-owned temporary files, compiler
artifacts and proof output were writable. No live guest, provider, service or
credential access occurred. This does not qualify macOS/Windows execution,
real-time timeout enforcement, or live guest recovery.

## Executed controls

```sh
node scripts/run-vitest.mjs test/scripts/parallels-smoke-model.test.ts --maxWorkers=1
node scripts/run-vitest.mjs test/scripts/parallels-smoke-model.test.ts --maxWorkers=1 -t 'requires usable macOS readiness before reset'
```

- Unchanged base: 135/135 passed; file test time 11.248s; command wall 55.080s.
- New controls: 3/3 passed; combined test time 3.613s on their first execution.
- Final formatted file: 138/138 passed; file test time 14.298s; command wall
  59.654s. Compiled-worker preparation was 36.262s before and 36.766s after.
- Increment: three CLI launches, 119 test lines, approximately 3.05s file test
  time in this paired observation. CI wall/CPU time has not been measured.

The existing file already exceeds the five-second target. Each added case
crosses the actual CLI/process boundary and protects a distinct admission or
recovery failure; it does not boot a whole product. No timeout, worker policy or
shared line-budget scalar was changed. The separate allocation grants exactly
this change's 119 new test lines; the base had no inherited line debt.

## Actual implementation mutants

Each variant changed only a disposable copy of `macos-smoke.ts`, mounted at the
real owner path. The same three tests ran through the repository wrapper.
Original production source was restored by ending that namespace, then checked
against the SHA-256 above. These are implementation mutations, not alterations
to expected traces.

| Disposable owner change                                                            | Observed failing assertion                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Remove `this.waitForCurrentUser()` from the skip-restore branch                    | Both recovery cases saw `write` without any `ready`; permanent refusal recorded a forbidden write.                 |
| Remove the username-validation condition, retaining the exit-status check          | Invalid-success case recorded `unready,write` without a valid username. Other two cases passed.                    |
| Throw instead of returning `false` for the first rejected readiness response       | Transient case recorded only `unready` and never reached valid readiness/reset; terminal diagnostic also differed. |
| Return instead of the terminal `guest current user did not become available` throw | Permanent case recorded a forbidden write after failed probes/fallbacks. Other two cases passed.                   |

All four mutant runs exited 1 because of the named assertions. No fixture crash,
missing dependency or process timeout is used as mutation discrimination.
Mutation runs preceded formatting-only changes to the test; the final formatted
file passed all 138 tests against the unchanged owner.

## Static checks

Targeted typechecking passed using `scripts/run-tsgo.mjs` and an untracked
configuration extending `test/tsconfig/tsconfig.test.root.json`, with only this
test file and the existing ambient declaration globs selected. Targeted oxlint
passed with zero warnings/errors using:

```sh
OPENCLAW_LINT_TOOL=oxlint node scripts/run-oxlint.mjs --tsconfig test/tsconfig/tsconfig.test.root.json test/scripts/parallels-smoke-model.test.ts
```

Formatting and exact-base line-allocation checks passed; the latter reports
6,589,276 test lines against a 6,589,308 ceiling (32 lines of unchanged slack).
Whitespace checks also passed. No publication, merge, or runtime deployment is implied.
