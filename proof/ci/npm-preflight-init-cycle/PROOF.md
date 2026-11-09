# Node npm preflight initialization

The canonical npm preflight CLI failed before validation on Node with an
unsettled top-level await. The same unchanged authority test failed in
[CI](https://github.com/openclaw/openclaw/actions/runs/42568759002/job/129001517536).
The observed failure is an initialization and availability failure; it does
not demonstrate an authority bypass.

The CLI no longer holds module initialization open while awaiting its work;
its exit status stays unsuccessful until the work succeeds. The verifier, validation,
receipt recovery, and live authority checks are unchanged, including the final
live authority check immediately before publication.

## Source and reproduction

- Base: `37365600bf67cab28ef5e180c5dfbfb400d88f83`.
- Changed CLI SHA-256: `f5e304629bb5fff977070d6a767613bba3d715b01bb56f9c30a42168d50f8c9f`.
- Changed test SHA-256: `c732b14e9f57e5bb8b2e619f9faebac83a6c3acfbb2f7f12d5a7db498bbb12f4`.
- Local runtime: Linux arm64, Node 24.22.1, Vitest 5.0.5, pnpm 12.15.0.
- Before the fix, the unchanged authority file had 7 passing cases and one
  failure: canonical preflight exited 13 before the revocation scenario.
- With synthetic mismatched lineage data, the canonical CLI exited 13 before
  the fix; importing the verifier first reached the expected validation
  rejection and exited 1. After the fix, the canonical CLI also exited 1 with
  `Candidate-owned artifact source and qualification SHA differ`.
- The fixture replaces GitHub and npm transport with synthetic responses. No
  actual release, publication, GitHub API request, or npm request was made.

## Verification

- `OPENCLAW_VITEST_RUNTIME=node node scripts/run-vitest.mjs test/scripts/openclaw-npm-publication-authority.test.ts --maxWorkers=1`: 9 passed; 34.21 seconds test duration.
- The same command with `OPENCLAW_VITEST_RUNTIME=bun`: 9 passed; 36.02 seconds test duration.
- Node runs of `test/scripts/full-release-receipt-recovery.test.ts` and
  `test/scripts/validate-full-release-validation-evidence.test.ts`: 51 passed.
- Targeted source and test lint, script and root-test type checks, formatting,
  and the test-line ratchet passed. The allocation grants the 31 added test
  lines; the base's seven lines of slack remain.
- Independent review of the source and test diff found no actionable findings.

The added case takes about 0.1 seconds and verifies canonical CLI rejection.
The existing authority file takes over 30 seconds because it exercises the
publisher and its synthetic admission, revocation, and receipt boundaries;
those cases were retained. Local proof uses arm64 and does not claim a replay
of the full hosted x64 shard or a successful release.
