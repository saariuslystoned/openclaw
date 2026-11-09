# Standalone descriptor-close test

The test checked that `fstatSync` failed on a descriptor number after a real
close. Another file can reuse that number immediately, producing a false red
even though the original descriptor was closed. A related failure was reported
in [CI](https://github.com/openclaw/openclaw/actions/runs/42293430401/job/128153038605).

The revised assertion verifies that the existing spy wrapping the real
`fs.closeSync` returned successfully. The existing checks still require one
call with the opened descriptor and retain the permission, admission, symlink,
and close-failure cases.

## Source and controls

- Base: `1d203729eef78ffca20ed5cd189df67f43ff766e`.
- Changed test SHA-256: `cd1ff45fe67ed40f9d8be27927e656207ad8d18c396298f99f8a50726a631210`.
- Control SHA-256: `01a03045fb26bfe8430cd7225df82073fe1348101379e93374d104f27a0a2896`.
- Runtime: Linux arm64, Node 24.22.1, Bun 1.4.4, Vitest 5.0.5.

The process-local diagnostic in the appendix observes the actual close for the
external resolver fixture. Its `observe` mode verifies that the descriptor is
closed.
Its `reuse` mode also reopens the same number for a different file identity and
closes the replacement afterward. With the original test, `observe` passed and
`reuse` failed at the old `fstatSync` assertion. With the change, both passed.
Each mode recorded the successful real close; the reuse mode recorded both the
new identity and the replacement close. The preload changes no repository
source and uses only disposable local descriptors.

To replay either control on Linux, extract the complete appendix into a
task-local file and verify the printed SHA-256 against the control hash above:

````sh
CONTROL="$(mktemp "${TMPDIR:-/tmp}/standalone-fd-control.XXXXXX")"
LOG="$(mktemp "${TMPDIR:-/tmp}/standalone-fd-control-log.XXXXXX")"
awk '/^```cjs$/ {copy=1; next} /^```$/ && copy {exit} copy {print}' \
  proof/ci/standalone-close-proof/PROOF.md > "$CONTROL"
sha256sum "$CONTROL"
````

Then run:

```sh
FD_CONTROL_MODE=reuse FD_CONTROL_LOG="$LOG" NODE_OPTIONS="--require=$CONTROL" \
  OPENCLAW_VITEST_RUNTIME=node node scripts/run-vitest.mjs \
  test/scripts/bun-standalone-metadata.test.ts --maxWorkers=1 \
  --testNamePattern='uses immutable embedded secret entrypoints and keeps external descriptor admission'
```

Repeat with `FD_CONTROL_MODE=observe`. Use the same copied control with the base checkout to reproduce the original
failure. This is a one-off diagnostic; CI does not execute it.

## Verification

- The complete test file passed 56/56 with Node and 56/56 with Bun. Vitest
  durations were 4.62 seconds and 5.07 seconds, respectively.
- Targeted lint, root-test type checks, formatting, and the test-line ratchet
  passed. The one net added test line uses existing baseline slack.
- Independent source and control review found no actionable findings.

The controlled reuse demonstrates the assertion's failure mechanism, not the
original hosted runner's exact scheduling or interleaving. Local proof used
arm64 and does not claim a full hosted x64 shard replay.

## Diagnostic control source

Copy the complete contents of this block byte-for-byte, including the final
newline, into the task-local `CONTROL` file described above.

```cjs
// Process-local diagnostic for the external resolver fixture; never changes source.
const fs = require("node:fs");
const realClose = fs.closeSync.bind(fs);
const realFstat = fs.fstatSync.bind(fs);
const mode = process.env.FD_CONTROL_MODE;
const log = process.env.FD_CONTROL_LOG;
let observed = false;

function record(value) {
  fs.appendFileSync(log, JSON.stringify({ pid: process.pid, ...value }) + "\n");
}

fs.closeSync = (fd) => {
  let target = false;
  if (!observed && Number.isInteger(fd)) {
    try {
      target = fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("/external/resolver.js");
    } catch {}
  }
  if (!target) return realClose(fd);
  observed = true;
  const original = realFstat(fd);
  const fillers = [];
  let replacement;
  try {
    if (mode === "reuse") {
      // Occupy lower vacancies while the target remains open, making it the
      // lowest free descriptor once closed. Keep every filler task-owned.
      for (let i = 0; i < 1024; i++) {
        const next = fs.openSync("/dev/null", "r");
        fillers.push(next);
        if (next > fd) break;
      }
      if (fillers.at(-1) <= fd) throw new Error("Could not occupy lower descriptor slots");
    }
    realClose(fd);
    let closed = false;
    try {
      realFstat(fd);
    } catch (error) {
      if (error.code !== "EBADF") throw error;
      closed = true;
    }
    if (!closed) throw new Error("Descriptor was not observed closed");
    if (mode === "reuse") {
      replacement = fs.openSync("/dev/null", "r");
      if (replacement !== fd) throw new Error("Descriptor was not reused as requested");
      const reused = realFstat(replacement);
      if (reused.dev === original.dev && reused.ino === original.ino) {
        throw new Error("Replacement unexpectedly has the same file identity");
      }
      record({ mode, fd, closed, reusedFd: replacement, differentIdentity: true });
      // The original assertion executes synchronously before this callback.
      const replacementToClose = replacement;
      setImmediate(() => {
        realClose(replacementToClose);
        record({ mode, fd, replacementClosed: true });
      });
      replacement = undefined;
    } else {
      record({ mode, fd, closed });
    }
  } finally {
    if (replacement !== undefined) realClose(replacement);
    for (const filler of fillers) realClose(filler);
  }
};
```
