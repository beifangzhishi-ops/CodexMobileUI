# Shared Windows Android build toolchain

This setup is **per Windows account and shared across projects**. Neither Java nor the Android SDK is installed under a particular app's `node_modules` or working directory.

## What it installs

The official Windows Eclipse Temurin JDK 17 package plus Google's Android SDK Command-line Tools 22.0, Platform Tools (adb), SDK platforms API 36 and 37.0, Build Tools 36.0.0 and 37.0.0, NDK 27.1.12297006 and 28.2.13676358, and **both CMake 3.22.1 and 3.31.6**. The older version is retained for projects that specifically need it.

Each Android project declares its own Gradle wrapper version, avoiding a globally pinned version. CodexMobileUI's stable Release builder uses the already-installed matching Gradle distribution read-only; its writable dependencies and temporary files stay in the ignored source-checkout `.tmp`.

## Installation on another Windows machine

1. Install the official `EclipseAdoptium.Temurin.17.JDK` with Windows Package Manager (winget). Confirm `javac.exe` is available under the Temurin 17 installation folder in `%ProgramFiles%\Eclipse Adoptium`.
2. Run [`scripts/setup-android-toolchain.ps1`](../scripts/setup-android-toolchain.ps1) in PowerShell with the `-AcceptLicenses` switch after reviewing the Android SDK licenses. This step requires network access to `dl.google.com`.
3. Open a **new terminal** to load the persistent user environment variables, and check `java -version`, `adb version` and `sdkmanager --list_installed`.

The setup script uses `curl.exe` and downloads Google's official Android command-line tools archive via 5 MiB HTTP ranges, checks the complete official SHA-256, then uses `sdkmanager` to install SDK components. It may be safely rerun. A regular full download can time out on some networks, whereas ranged downloads can succeed.

Android 17 uses the package path `platforms;android-37.0`, **not** `platforms;android-37`. Build configurations still commonly use `compileSdk = 37`. Preinstalling the platform before the Gradle build avoids an Android Gradle Plugin on-demand-install mismatch seen on some CI systems.

## Windows React Native / Expo long paths

Expo SDK 58's Android New Architecture CMake graph may generate object file paths longer than 260 characters even when the repository is in a normal location. **CMake 3.22.1 ships Ninja 1.10.2**, which rejects these paths on Windows. Google's CMake 3.31.6 includes Ninja 1.12.1 with long-path support. See the [Expo Windows long-path guide](https://docs.expo.dev/troubleshooting/windows-long-paths/).

Two prerequisites are required:

1. Confirm Windows registry `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` is `1`. Changing the machine policy requires administrator approval; restart affected processes or Windows as instructed by the operating system. On the primary 6v host this was already `1` on 2026-11-04.
2. Install `cmake;3.31.6` through the official Android SDK manager, and pass `-Pandroid.cmakeVersion=3.31.6` **only for Windows builds that need it**. The shared installation on 6v has been verified: Ninja reports version `1.12.1`.

For normal builds, invoke scripts/build-android-stable.ps1 rather than directly building from the source checkout. It builds an ARM64 **Release test APK with embedded JavaScript**, suitable for installation without Metro; Debug builds still require Metro. The Release variant uses the project's **debug keystore** for testing, not a production release identity. The lower-level scripts/build-android-windows.ps1 validates toolchain versions, the APK signature and the embedded JS bundle.

The stable entry point synchronizes current sources into one persistent, short-path build checkout under the Windows user profile (CodexMobileUI-AndroidBuild by default). Native Gradle/CMake outputs, node_modules and exclusive build locks remain in that separate short-path checkout. The **writable Gradle user home and TEMP/TMP** are instead held in the source checkout's ignored `.tmp/gradle-user` and `.tmp/build-temp`. The Gradle executable comes from the already-installed matching distribution and is used read-only; the global wrapper lock and dependency cache are not written. Existing incremental native caches are retained; only real dependency lockfile changes trigger npm ci. A package version-only change does not reinstall dependencies. No process is killed automatically. On success, the selected native build root is stored in ignored `.tmp/android-build-root.txt`.

**Interrupted build recovery:** The stable builder atomically persists `.tmp/android-build-state.json` inside the external build checkout, including the attempt ID, phase (`preparing`, `building`, `built`, `verifying`, `published` or `failed`), source fingerprint, expected APK identity, Gradle start timestamp and output file. Gradle writes combined native stdout/stderr directly to the attempt's `.tmp/android-build-logs/release-*.gradle.log` file; the separate PowerShell transcript records launcher actions. If CCM ends the parent shell early, active Gradle children can still hold the build lock and complete writing their output. Do not delete the lock or launch a competing build. After the lock is free, rerun **exactly the same Release invocation**: when the source fingerprint, version, APK path and file timestamp match the interrupted attempt, the script skips Gradle and instead verifies the package/version, signing certificate, ARM64 Release JS bundle and SHA-256 before copying the artifact. If the input source has changed or the APK is stale, it starts a normal new build; a failed or already published attempt is never treated as recoverable. Inspect state with `node.exe scripts/android-build-state.mjs status <external-build-root>` from the source checkout. Recovered APKs still require a separate confirmed CCM publication.

The following PowerShell commands run the source checkout's stable builder:

    & 'C:\Users\Songjx\Documents\ChatGPT\CodexMobileUI\scripts\build-android-stable.ps1' -CheckOnly
    & 'C:\Users\Songjx\Documents\ChatGPT\CodexMobileUI\scripts\build-android-stable.ps1' -Variant Release

The preflight verifies the Expo version, npm package version, generated native Gradle version and Android identity together with JDK 17, Node 24, SDK, NDK and Ninja. The output is published to ignored .tmp/android-artifacts with the version in the APK filename. The builder also verifies APK identity, signature, embedded Release JavaScript and its SHA-256, and checks certificate continuity against the most recent earlier local Release artifact if present. The full native Gradle log and a separate PowerShell transcript are saved under the external build checkout's ignored .tmp/android-build-logs directory. Specify -BuildRoot only when intentionally reusing an existing independent build checkout.

**Delivery (current):** Once a Release APK passes build-state, identity, ARM64, embedded JS, signature and SHA-256 verification, publish that exact `.tmp/android-artifacts/CodexMobileUI-<version>-release-arm64.apk` through CCM `publish` into the current ChatGPT conversation. Do **not** use the older Quark release workflow. A build or publication does not replace a physical-device installation test.

On the **first build after upgrading from CMake 3.22.1**, pass `-RegenerateCMake` to remove only `android/app/.cxx` and `android/app/build` (generated cache directories), so Gradle regenerates its native build graph with the newer Ninja. Ordinary incremental builds should omit this switch.

Every CodexMobileUI stable build (including `-CheckOnly`) now uses `-UseWorkspaceCache` with the source checkout's ignored `.tmp` directory. This avoids the need for a global Gradle write permission under restricted CCM. The first isolated build may need to resolve dependencies that were only cached globally; treat download errors as build failures rather than silently writing to the global cache. Use `-CheckOnly` for a no-build preflight.

**Verified 6v build on 2026-11-12:** The stable Release command received CCM's controlled automatic approval and completed the ARM64 build without moving the short-path native cache or disabling R8. The earlier restricted build left Ninja processes waiting indefinitely; its associated build processes were stopped only after validating their IDs, birth times, the build transcript and exclusive locks. The authorized retry passed Expo/app native CMake, Metro bundling and R8 optimization. Ninja reporting zero CPU does not mean child Clang compilers have stalled; inspect their child processes and CPU activity. R8 can also run for several minutes without writing Gradle log lines, while consuming CPU, before successfully finishing. A guarded stop attempt correctly refused to stop the job after the build state had already changed to `published`. Gradle reported `BUILD SUCCESSFUL in 20m 30s`, 605 actionable tasks (60 executed, 545 up-to-date). The independently verified test artifact is `CodexMobileUI-0.1.5-release-arm64.apk` (30,016,591 bytes; SHA-256 `324B6CF43A4A9791E3C2BFB509514A218E5CE28303EC565770731FB901F84896`), uploaded with Quark FINISH/100% and matching size. Never infer a build has failed from quiet logs alone, and do not change Release optimization flags without verified evidence.

Do **not** hard-code this version in cross-platform `android/gradle.properties`. Linux hosted builds may not include CMake 3.31.6. Do not replace CMake 3.22.1's Ninja executable in-place; keeping the two SDK packages side by side is safer for other projects. If using a restricted CCM Windows sandbox, native Ninja subprocesses can stall even with the correct tools: use an explicitly authorized full-access CCM execution for the Android build.

**Verified incremental build on 2026-11-24:** `scripts/build-android-stable.ps1 -Variant Release` reused the persistent `C:\Users\Songjx\cmui-build-v011` checkout. The first 0.2.0 pass completed R8 and emitted a test-signed ARM64 APK; an identical final-source pass completed immediately with Gradle up-to-date, then re-verified the artifact. The final APK is `dev.codexmobileui.app`, version `0.2.0` (`versionCode` 27), contains the embedded Release JS and ARM64 libraries, has APK Signature Scheme v2 with the same test certificate as the previous release, and is 23,038,954 bytes with SHA-256 `9284CB07B057E8FE2FFC04C10AEC82B0B17B83CFD1F5519D6DD1D56B18296282`. This build was not installed on a device because the installed unified device-validation entry supports only macOS launchd and returned an initialization error on the current Windows host.

## 2026-11-23 Ninja/CMake stall investigation and successful authorized rebuild

**Initial failure:** On 6v the stable Release build of 0.1.24 (versionCode 26) started via ordinary CCM `exec_command` in a medium-integrity, restricted token. Its dedicated native checkout was `C:\Users\Songjx\cmui-build-v011`, **outside** the source workspace. The Gradle transcript `release-20261123-193203.gradle.log` stopped progressing at `:expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a]` and `:app:buildCMakeRelWithDebInfo[arm64-v8a]`, while the two Ninja children were sitting at `[0/2] Re-checking globbed directories...`. Their CPU usage and native log did not progress during observation. A stalled Ninja process alone is not proof that ACLs are responsible; check child Clang tasks and the build-state phase before declaring a deadlock.

After stopping only those identified build-owned Ninja children, the regular retry with `-RegenerateCMake` failed at `Remove-Item` while removing generated `android/app/build/.../libc++_shared.so` with **Access denied**. ACL inspection showed `DESKTOP-KFL6V1F\CodexSandboxUsers` has **ReadAndExecute** on that generated file and build directory, whereas the host user `Songjx` has **FullControl**. Thus the attempted cache reset was conclusively blocked by CCM's restricted file access to the out-of-workspace checkout. This does *not* establish that Windows administrator elevation is necessary: first request CCM `sandbox_permissions=require_escalated` for the fixed stable build command, not `run_as_admin`, and do not loosen shared SDK/global Gradle ACLs.

Recommended recovery sequence:

1. Check `node.exe scripts/android-build-state.mjs status C:\Users\Songjx\cmui-build-v011`, the last `release-*.gradle.log` and transcript, and the exact child process identity/CPU before attempting any stop. Never delete a live build lock or terminate unrelated Ninja/Gradle/Java processes. Avoid changing the source, version or cached APK while a build is still running.
2. Run `& .\scripts\build-android-stable.ps1 -Variant Release -CheckOnly` first; this passed on 2026-11-23 with JDK 17.0.20.1, Node v24.19.0, CMake 3.31.6 / Ninja 1.12.1, Gradle 9.4.1, API/Build Tools 37 and NDK 27.1. It is a **preflight only** and does not prove native compilation.
3. Request explicit authorized CCM full-access execution for `& .\scripts\build-android-stable.ps1 -Variant Release -RegenerateCMake` on the existing 6v registered workspace. The `-RegenerateCMake` option intentionally deletes only generated **app-side** `android/app/.cxx` and `android/app/build` in the separate build checkout before regeneration; prefer `-Variant Release` without that option on subsequent healthy incremental builds. The builder also needs permitted writes to the independent build checkout and source `.tmp` workspace caches.
4. If Guardian replies `review_failed`, retry that *same escalation once* if `review_retryable=true`; if a second review fails, **stop** and await functioning automatic approval. Do not evade the permission boundary by moving the build, adjusting ACLs or manually deleting protected files. Earlier attempts on 2026-11-23 failed before dispatch; a later attempt was approved and ran successfully.
5. After an authorized retry, require `BUILD SUCCESSFUL` in the current Gradle log plus the stable builder's final identity, signature, bundle and hash verification. Confirm the APK timestamp and source fingerprint against the *new* attempt; publish only the verified current artifact through CCM, then verify behavior on the phone.

**Verified recovery on 2026-11-23:** CCM Guardian approved the fixed `& .\scripts\build-android-stable.ps1 -Variant Release -RegenerateCMake` with `sandbox_permissions=require_escalated` and narrow prefix `['.\scripts\build-android-stable.ps1','-Variant','Release','-RegenerateCMake']`. No Windows UAC administrator token or global ACL edit was needed. The approved command successfully deleted the generated app cache, regenerated CMake, completed Ninja ARM64 compilation, Metro bundle (692 modules) and R8. `release-20261123-194419.gradle.log` reports **BUILD SUCCESSFUL in 8m 23s** (642 tasks: 60 executed, 582 up-to-date). The stable script verified application identity `dev.codexmobileui.app`, **0.1.24 (versionCode 26)**, embedded Release JS (1,455,404 bytes), ARM64 libraries, APK v2 signature, matching previous signing identity and SHA-256. Verified artifact: `.tmp/android-artifacts/CodexMobileUI-0.1.24-release-arm64.apk` (23,035,150 bytes), SHA-256 `FB837438112765445F081BBF48AD8524C131C52BDA04572160E75C0EDB4E5552`. Published through CCM as time-limited publication ID `757bd3ba-7cde-4368-871d-2668446448bf`. Physical Android installation and on-device UI verification remain outstanding. **For healthy incremental builds omit `-RegenerateCMake`; request the same authorized external-cache access when required.**

**Do not equate CCM `require_escalated` with Windows UAC administrator elevation.** The previously failing Ninja build succeeded with authorized CCM full access and CMake regeneration. The evidence supports the external-cache permission issue as the practical blocker, but the combined retry does not prove permissions were the *only* cause of the previous Ninja stall.

## Shared locations

| Component | Shared location |
| --- | --- |
| JDK | `%ProgramFiles%\Eclipse Adoptium\jdk-17*-hotspot` |
| SDK, NDK, adb, build-tools and CMake | `%LOCALAPPDATA%\Android\Sdk` |
| SDK command line utilities | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin` |
| Shared Gradle distributions and dependencies | `%USERPROFILE%\.gradle` |

The script persists `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `GRADLE_USER_HOME` and appends the JDK, adb and SDK manager binaries to the user `PATH`. Restart any already-open terminal or build daemon that still sees old environment values.

Android Studio GUI, emulator/system images, device drivers for particular phones and release-signing keystores are **not** required for a debug APK build and are not installed by the script. Signing identities are app-specific and must never be reused or committed by default.

This setup was tested on the primary Windows development host on 2026-11-04. The installer and Android SDK versions may require updating when upstream Android/Expo versions change.
