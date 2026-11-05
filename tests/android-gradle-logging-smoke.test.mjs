// Execute directly with node --test on Windows when process spawning is permitted.
// The standard sandbox-safe npm check intentionally does not launch native commands.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("a cmd wrapper writes both Gradle streams to disk and preserves exit status", {
  skip: process.platform !== "win32",
}, () => {
  const parent = resolve(".tmp");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(join(parent, "android-gradle-smoke-"));
  try {
    const mock = join(folder, "mock-gradle.cmd");
    const launcher = join(folder, "android-gradle-command.cmd");
    const log = join(folder, "release.gradle.log");
    writeFileSync(mock, [
      "@echo off",
      "echo stdout fixture",
      "echo stderr fixture 1>&2",
      "exit /b 23",
      "",
    ].join("\r\n"));
    writeFileSync(launcher, [
      "@echo off",
      `call "${mock}" 1>> "${log}" 2>&1`,
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n"));
    const result = spawnSync("cmd.exe", ["/d", "/c", launcher], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 23);
    const logged = readFileSync(log, "utf8");
    assert.match(logged, /stdout fixture/);
    assert.match(logged, /stderr fixture/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
