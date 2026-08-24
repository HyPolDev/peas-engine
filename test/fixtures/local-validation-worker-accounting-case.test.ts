import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

test("synthetic token-bound child graph settles completely", async () => {
  const synchronous = spawnSync(process.execPath, ["-e", ""], {
    windowsHide: true,
    stdio: "ignore",
  });
  assert.equal(synchronous.status, 0, synchronous.error?.message);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["-e", ""], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else rejectPromise(new Error(`synthetic-child-failed:${code}:${signal}`));
    });
  });
});

test("synthetic forced child remains parent-attributable", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", rejectPromise);
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === null && typeof signal === "string") resolvePromise();
      else rejectPromise(new Error(`synthetic-forced-child-failed:${code}:${signal}`));
    });
  });
});
