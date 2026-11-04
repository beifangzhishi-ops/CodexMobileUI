import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync(new URL("../scripts/mobile-shared-launcher.ps1", import.meta.url), "utf8");
const mobileStop = readFileSync(new URL("../Stop-CodexMobile.cmd", import.meta.url), "utf8");
const sharedStop = readFileSync(new URL("../shared-stop.cmd", import.meta.url), "utf8");

test("starting MobileUI ensures or hot-attaches to the shared App Server before Gateway startup", () => {
  assert.match(launcher, /Invoke-SharedStack "start"\s*\r?\n\s*Start-Gateway/);
  assert.match(launcher, /function Start-Gateway/);
});

test("normal MobileUI shutdown stops only Gateway, preserving shared backend", () => {
  const stopBranch = launcher.match(/if \(\$Action -eq "stop"\) \{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(stopBranch, "MobileUI launcher must have a dedicated stop branch");
  assert.match(stopBranch[1], /Stop-Gateway/);
  assert.doesNotMatch(stopBranch[1], /Invoke-SharedStack|Stop-Stack/);
  assert.match(mobileStop, /mobile-shared-launcher\.ps1" -Action stop/);
  assert.doesNotMatch(mobileStop, /shared-stack\.ps1|shared-stop\.cmd/);
});

test("explicit shared-stop remains an independent administrative action", () => {
  assert.match(sharedStop, /shared-stack\.ps1" -Action stop/);
});
