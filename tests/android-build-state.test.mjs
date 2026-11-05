import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  beginBuild, canResume, readState, saveState, setPhase, sourceFingerprint, sourceMatches, stateFile,
} from "../scripts/android-build-state.mjs";

const fixtureRoot = resolve(".tmp");
mkdirSync(fixtureRoot, { recursive: true });
const temp = mkdtempSync(join(fixtureRoot, "cmui-build-state-"));
const source = join(temp, "source");
const build = join(temp, "build");
const apk = join(build, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
mkdirSync(source, { recursive: true });
mkdirSync(join(source, "src"), { recursive: true });
mkdirSync(join(source, ".tmp"), { recursive: true });
mkdirSync(join(build, ".tmp"), { recursive: true });
mkdirSync(join(apk, ".."), { recursive: true });
writeFileSync(join(source, "src", "app.ts"), "export const version = 1;");
writeFileSync(join(source, ".tmp", "secret.txt"), "ignored test fixture");

test.after(() => rmSync(temp, { recursive: true, force: true }));

const identity = ["Release", "0.1.3", "5", "dev.codexmobileui.app"];
const fresh = () => new Date(Date.now() + 60000);

test("source fingerprint changes for meaningful sources, but not ignored outputs", () => {
  const first = sourceFingerprint(source);
  writeFileSync(join(source, ".tmp", "secret.txt"), "changed ignored fixture");
  assert.equal(sourceFingerprint(source), first);
  writeFileSync(join(source, "src", "app.ts"), "export const version = 2;");
  assert.notEqual(sourceFingerprint(source), first);
  const next = sourceFingerprint(source);
  writeFileSync(join(source, "new.ts"), "export const added = true;");
  assert.notEqual(sourceFingerprint(source), next);
});

test("recovery requires a fresh APK from exactly this build and unchanged sources", () => {
  const record = beginBuild(source, build, ...identity, join(build, ".tmp", "gradle.log"));
  assert.equal(record.phase, "preparing");
  assert.equal(canResume(source, build, ...identity, apk), false);
  writeFileSync(apk, "signed APK placeholder");
  setPhase(build, "building");
  utimesSync(apk, new Date("2025-01-01"), new Date("2025-01-01"));
  assert.equal(canResume(source, build, ...identity, apk), false, "old output is never reusable");
  assert.equal(sourceMatches(source, build, ...identity), true, "successful incremental Gradle may reuse an older APK");
  utimesSync(apk, fresh(), fresh());
  assert.equal(canResume(source, build, ...identity, apk), true);
  assert.equal(canResume(source, build, "Debug", ...identity.slice(1), apk), false);
  assert.equal(canResume(source, build, "Release", "0.1.4", ...identity.slice(2), apk), false);
  assert.equal(canResume(source, build, ...identity, join(build, "unrelated.apk")), false);
  writeFileSync(join(source, "src", "app.ts"), "export const version = 3;");
  assert.equal(canResume(source, build, ...identity, apk), false, "source drift blocks publication");
  assert.equal(sourceMatches(source, build, ...identity), false);
  writeFileSync(join(source, "src", "app.ts"), "export const version = 2;");
  assert.equal(canResume(source, build, ...identity, apk), true);
});

test("only valid transitions can publish and publication cannot be mistaken for an active build", () => {
  setPhase(build, "verifying");
  assert.equal(canResume(source, build, ...identity, apk), true);
  setPhase(build, "verifying");
  const verified = readState(build);
  assert.equal(verified.phase, "verifying");
  assert.throws(() => setPhase(build, "building"), /Invalid Android build transition/);
  setPhase(build, "published", { artifact: apk, size: 123, sha256: "A".repeat(64) });
  assert.equal(readState(build).sha256, "A".repeat(64));
  assert.equal(canResume(source, build, ...identity, apk), false);
  assert.throws(() => setPhase(build, "failed"), /Invalid Android build transition/);
  assert.equal(JSON.parse(readFileSync(stateFile(build), "utf8")).phase, "published");
});

test("interrupted recovery and failure statuses are unambiguous", () => {
  beginBuild(source, build, ...identity, join(build, ".tmp", "gradle.log"));
  setPhase(build, "building");
  utimesSync(apk, fresh(), fresh());
  assert.equal(canResume(source, build, ...identity, apk), true);
  setPhase(build, "failed", { error: "synthetic test failure" });
  assert.equal(readState(build).phase, "failed");
  assert.equal(readState(build).error, "synthetic test failure");
  assert.equal(canResume(source, build, ...identity, apk), false);
});

test("invalid persisted records fail closed", () => {
  saveState(build, { schema: 8, phase: "published" });
  assert.throws(() => readState(build), /Unknown Android build state schema/);
});
