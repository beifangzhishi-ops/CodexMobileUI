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

**Interrupted build recovery:** The stable builder atomically persists `.tmp/android-build-state.json` inside the external build checkout, including the attempt ID, phase (`preparing`, `building`, `built`, `verifying`, `published` or `failed`), source fingerprint, expected APK identity, Gradle start timestamp and output file. Gradle writes combined native stdout/stderr directly to the attempt's `.tmp/android-build-logs/release-*.gradle.log` file; the separate PowerShell transcript records launcher actions. If CCM ends the parent shell early, active Gradle children can still hold the build lock and complete writing their output. Do not delete the lock or launch a competing build. After the lock is free, rerun **exactly the same Release invocation**: when the source fingerprint, version, APK path and file timestamp match the interrupted attempt, the script skips Gradle and instead verifies the package/version, signing certificate, ARM64 Release JS bundle and SHA-256 before copying the artifact. If the input source has changed or the APK is stale, it starts a normal new build; a failed or already published attempt is never treated as recoverable. Inspect state with `node.exe scripts/android-build-state.mjs status <external-build-root>` from the source checkout. Recovered APKs still require Quark upload as a separate confirmed CCM action.

The following PowerShell commands run the source checkout's stable builder:

    & 'C:\Users\Songjx\Documents\ChatGPT\CodexMobileUI\scripts\build-android-stable.ps1' -CheckOnly
    & 'C:\Users\Songjx\Documents\ChatGPT\CodexMobileUI\scripts\build-android-stable.ps1' -Variant Release

The preflight verifies the Expo version, npm package version, generated native Gradle version and Android identity together with JDK 17, Node 24, SDK, NDK and Ninja. The output is published to ignored .tmp/android-artifacts with the version in the APK filename. The builder also verifies APK identity, signature, embedded Release JavaScript and its SHA-256, and checks certificate continuity against the most recent earlier local Release artifact if present. The full native Gradle log and a separate PowerShell transcript are saved under the external build checkout's ignored .tmp/android-build-logs directory. Specify -BuildRoot only when intentionally reusing an existing independent build checkout.

**Delivery:** When an APK passes validation, use CCM's `ccm-extra.quark_upload` tool on the 6v Worker to send the exact versioned APK from .tmp/android-artifacts to the signed-in Quark client. Wait for status `FINISH`, progress 100%, and matching file sizes, then report the filename and cloud destination to the owner. This is the default for every subsequent APK, avoiding the ChatGPT file-publishing size limit. The 0.1.1 Release test APK was verified uploaded to **夸克上传文件** on 2026-11-04. Cloud upload must not be confused with physical-device validation, and must never include credentials, keystores or private host data.

On the **first build after upgrading from CMake 3.22.1**, pass `-RegenerateCMake` to remove only `android/app/.cxx` and `android/app/build` (generated cache directories), so Gradle regenerates its native build graph with the newer Ninja. Ordinary incremental builds should omit this switch.

Every CodexMobileUI stable build (including `-CheckOnly`) now uses `-UseWorkspaceCache` with the source checkout's ignored `.tmp` directory. This avoids the need for a global Gradle write permission under restricted CCM. The first isolated build may need to resolve dependencies that were only cached globally; treat download errors as build failures rather than silently writing to the global cache. Use `-CheckOnly` for a no-build preflight.

Do **not** hard-code this version in cross-platform `android/gradle.properties`. Linux hosted builds may not include CMake 3.31.6. Do not replace CMake 3.22.1's Ninja executable in-place; keeping the two SDK packages side by side is safer for other projects. If using a restricted CCM Windows sandbox, native Ninja subprocesses can stall even with the correct tools: use an explicitly authorized full-access CCM execution for the Android build.

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
