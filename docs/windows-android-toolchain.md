# Shared Windows Android build toolchain

This setup is **per Windows account and shared across projects**. Neither Java nor the Android SDK is installed under a particular app's `node_modules` or working directory.

## What it installs

The official Windows Eclipse Temurin JDK 17 package plus Google's Android SDK Command-line Tools 22.0, Platform Tools (adb), SDK platforms API 36 and 37.0, Build Tools 36.0.0 and 37.0.0, NDK 27.1.12297006 and 28.2.13676358, and CMake 3.22.1.

Each Android project continues to use **its own Gradle wrapper**, avoiding a globally pinned Gradle version that may be incompatible with other projects. Gradle distributions, dependencies and caches are reused automatically from `%USERPROFILE%\.gradle`.

## Installation on another Windows machine

1. Install the official `EclipseAdoptium.Temurin.17.JDK` with Windows Package Manager (winget). Confirm `javac.exe` is available under the Temurin 17 installation folder in `%ProgramFiles%\Eclipse Adoptium`.
2. Run [`scripts/setup-android-toolchain.ps1`](../scripts/setup-android-toolchain.ps1) in PowerShell with the `-AcceptLicenses` switch after reviewing the Android SDK licenses. This step requires network access to `dl.google.com`.
3. Open a **new terminal** to load the persistent user environment variables, and check `java -version`, `adb version` and `sdkmanager --list_installed`.

The setup script uses `curl.exe` and downloads Google's official Android command-line tools archive via 5 MiB HTTP ranges, checks the complete official SHA-256, then uses `sdkmanager` to install SDK components. It may be safely rerun. A regular full download can time out on some networks, whereas ranged downloads can succeed.

Android 17 uses the package path `platforms;android-37.0`, **not** `platforms;android-37`. Build configurations still commonly use `compileSdk = 37`. Preinstalling the platform before the Gradle build avoids an Android Gradle Plugin on-demand-install mismatch seen on some CI systems.

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
