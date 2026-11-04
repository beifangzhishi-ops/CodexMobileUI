# Shared Windows Android build toolchain

This setup is **per Windows account and shared across projects**. Neither Java nor the Android SDK is installed under a particular app's `node_modules` or working directory.

## What it installs

The official Windows Eclipse Temurin JDK 17 package plus Google's Android SDK Command-line Tools 22.0, Platform Tools (adb), SDK platforms API 36 and 37.0, Build Tools 36.0.0 and 37.0.0, NDK 27.1.12297006 and 28.2.13676358, and **both CMake 3.22.1 and 3.31.6**. The older version is retained for projects that specifically need it.

Each Android project continues to use **its own Gradle wrapper**, avoiding a globally pinned Gradle version that may be incompatible with other projects. Gradle distributions, dependencies and caches are reused automatically from `%USERPROFILE%\.gradle`.

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

For this checkout, use `scripts/build-android-debug-windows.ps1`. On the **first build after upgrading from CMake 3.22.1**, pass `-RegenerateCMake` to remove only `android/app/.cxx` and `android/app/build` (generated cache directories), so Gradle regenerates its native build graph with the newer Ninja. Pass `-UseWorkspaceCache` only when the execution environment cannot write to the normal user-wide Gradle and temporary directories. Both switches are optional thereafter.

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
