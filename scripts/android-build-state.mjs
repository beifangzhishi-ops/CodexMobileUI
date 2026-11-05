// Persistent, non-secret build provenance for the Windows Android stable builder.
// The source fingerprint includes tracked and nonignored untracked inputs.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const phases = new Set(["preparing", "building", "built", "verifying", "published", "failed"]);
const resumablePhases = new Set(["building", "built", "verifying"]);

export function sourceFingerprint(sourceRoot) {
  // Hash the files the stable robocopy stages, not just git-tracked files.
  // This includes ignored-but-staged source files and excludes native build caches and secrets.
  const excludedDirs = new Set([
    ".git", ".tmp", ".npm-cache", ".local-home", ".expo", ".expo-shared",
    ".state", ".runtime", "node_modules", "dist", "coverage",
  ]);
  const nativeExcludedDirs = new Set([".gradle", ".cxx", "build"]);
  const secretExtensions = new Set([".jks", ".p12", ".pfx", ".pem", ".key"]);
  const names = [];
  function walk(dir, prefix) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix ? prefix + "/" + item.name : item.name;
      if (item.isDirectory()) {
        if (!excludedDirs.has(item.name) &&
            !(name.startsWith("android/") && nativeExcludedDirs.has(item.name))) {
          walk(join(dir, item.name), name);
        }
      } else if (item.isFile()) {
        if (item.name !== ".env" && !item.name.startsWith(".env.") &&
            !secretExtensions.has(extname(item.name).toLowerCase())) {
          names.push(name);
        }
      }
    }
  }
  walk(sourceRoot, "");
  names.sort();
  const digest = createHash("sha256");
  for (const name of names) {
    const candidate = resolve(sourceRoot, name);
    const local = statSync(candidate, { throwIfNoEntry: false });
    digest.update(name, "utf8");
    digest.update("\0");
    if (!local) {
      digest.update("MISSING");
    } else if (local.isFile()) {
      digest.update(createHash("sha256").update(readFileSync(candidate)).digest("hex"));
    } else {
      digest.update("NONFILE");
    }
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function stateFile(buildRoot) {
  return join(buildRoot, ".tmp", "android-build-state.json");
}

export function readState(buildRoot) {
  const file = stateFile(buildRoot);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (record.schema !== 1 || !phases.has(record.phase)) {
    throw new Error("Unknown Android build state schema or phase.");
  }
  return record;
}

export function saveState(buildRoot, state) {
  const file = stateFile(buildRoot);
  mkdirSync(dirname(file), { recursive: true });
  const pending = file + "." + randomUUID() + ".tmp";
  writeFileSync(pending, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  renameSync(pending, file);
}

export function beginBuild(sourceRoot, buildRoot, variant, version, code, appId, gradleLog) {
  const state = {
    schema: 1,
    runId: randomUUID(),
    phase: "preparing",
    sourceRoot: resolve(sourceRoot),
    buildRoot: resolve(buildRoot),
    sourceFingerprint: sourceFingerprint(sourceRoot),
    variant, version, code, appId,
    gradleLog: resolve(gradleLog),
    createdAt: new Date().toISOString(),
    gradleStartedAt: null,
  };
  saveState(buildRoot, state);
  return state;
}

export function setPhase(buildRoot, next, details = {}) {
  if (!phases.has(next)) throw new Error("Invalid build phase.");
  const state = readState(buildRoot);
  if (!state) throw new Error("No Android build state to update.");
  const allowed = {
    preparing: ["building", "failed"],
    building: ["built", "verifying", "failed"],
    built: ["verifying", "failed"],
    // A recovered invocation may re-enter verification after its parent died.
    verifying: ["verifying", "published", "failed"],
    published: [],
    failed: [],
  };
  if (!allowed[state.phase].includes(next)) {
    throw new Error("Invalid Android build transition: " + state.phase + " -> " + next);
  }
  const updated = { ...state, ...details, phase: next };
  if (next === "building") {
    updated.gradleStartedAt = new Date().toISOString();
  }
  saveState(buildRoot, updated);
  return updated;
}

export function canResume(sourceRoot, buildRoot, variant, version, code, appId, apk) {
  const state = readState(buildRoot);
  if (!state || !resumablePhases.has(state.phase)) return false;
  if (!sourceMatches(sourceRoot, buildRoot, variant, version, code, appId, state)) return false;
  const expected = resolve(buildRoot, "android", "app", "build", "outputs",
    "apk", variant.toLowerCase(), "app-" + variant.toLowerCase() + ".apk");
  if (resolve(apk) !== expected || !isAbsolute(apk)) return false;
  if (!state.gradleStartedAt) return false;
  const file = statSync(apk, { throwIfNoEntry: false });
  // Only an output produced after this exact attempt began may be recovered.
  return Boolean(file?.isFile() && file.size > 0 &&
    file.mtimeMs >= Date.parse(state.gradleStartedAt) - 2000);
}

export function sourceMatches(sourceRoot, buildRoot, variant, version, code, appId, providedState = null) {
  const state = providedState ?? readState(buildRoot);
  if (!state || !resumablePhases.has(state.phase)) return false;
  if (state.sourceRoot !== resolve(sourceRoot) || state.buildRoot !== resolve(buildRoot)) return false;
  if (state.variant !== variant || state.version !== version ||
      state.code !== code || state.appId !== appId) return false;
  if (state.sourceFingerprint !== sourceFingerprint(sourceRoot)) return false;
  return true;
}

function main(argv) {
  const [action, ...args] = argv;
  if (action === "inspect") {
    console.log(canResume(...args) ? "RESUME" : "BUILD");
  } else if (action === "source-match") {
    console.log(sourceMatches(...args) ? "MATCH" : "CHANGED");
  } else if (action === "begin") {
    const record = beginBuild(...args);
    console.log("Started Android build " + record.runId);
  } else if (action === "phase") {
    setPhase(args[0], args[1]);
  } else if (action === "finish") {
    setPhase(args[0], "published", {
      artifact: resolve(args[1]), sha256: args[2], size: Number(args[3]),
    });
  } else if (action === "fail") {
    const state = readState(args[0]);
    if (state && !["failed", "published"].includes(state.phase)) {
      setPhase(args[0], "failed", { error: String(args[1]).slice(0, 500) });
    }
  } else if (action === "status") {
    console.log(JSON.stringify(readState(args[0]), null, 2));
  } else {
    throw new Error("Unknown Android build state operation.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
