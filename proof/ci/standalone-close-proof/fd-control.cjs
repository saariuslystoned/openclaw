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
