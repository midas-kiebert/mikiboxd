#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$MOBILE_DIR/android"
OUT_DIR="$MOBILE_DIR/dist/apk"
JDK_CACHE_DIR="$MOBILE_DIR/.tooling/jdks"

usage() {
  cat <<'EOF'
Build an Android APK for the mobile app.

Usage:
  ./scripts/build-android-apk.sh gradle [debug|release]

Examples:
  ./scripts/build-android-apk.sh gradle debug
  ./scripts/build-android-apk.sh gradle release

Notes:
  This script runs 'expo prebuild' before Gradle so changes in app.json
  (name/icon/splash, etc.) are reflected in the native Android project.
  Set SKIP_EXPO_PREBUILD=1 to skip.
EOF
}

java_major_version() {
  local java_cmd="$1"
  local version_line version_token major
  version_line="$("$java_cmd" -version 2>&1 | head -n 1)"
  version_token="$(echo "$version_line" | sed -E 's/.*version "([^"]+)".*/\1/')"

  if [[ "$version_token" == 1.* ]]; then
    major="$(echo "$version_token" | cut -d. -f2)"
  else
    major="$(echo "$version_token" | cut -d. -f1)"
  fi
  echo "$major"
}

java_major_in_supported_range_for_android() {
  local major="$1"
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 17 && major <= 24 ))
}

find_best_supported_jdk_home() {
  local best_home=""
  local best_major=0
  local candidate major

  for candidate in /usr/lib/jvm/* "${SDKMAN_CANDIDATES_DIR:-}/java"/*; do
    [[ -d "$candidate" ]] || continue
    [[ -x "$candidate/bin/java" ]] || continue

    major="$(java_major_version "$candidate/bin/java")"
    if java_major_in_supported_range_for_android "$major" && (( major > best_major )); then
      best_home="$candidate"
      best_major="$major"
    fi
  done

  if [[ -n "$best_home" ]]; then
    echo "$best_home"
  fi
}

find_android_sdk_home() {
  local candidate
  local candidates=(
    "${ANDROID_HOME:-}"
    "${ANDROID_SDK_ROOT:-}"
    "$HOME/android-sdk"
    "$HOME/Android/Sdk"
    "$HOME/Android/sdk"
    "/opt/android-sdk"
    "/usr/lib/android-sdk"
  )

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    if [[ -d "$candidate/platform-tools" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v adb >/dev/null 2>&1; then
    candidate="$(dirname "$(dirname "$(realpath "$(command -v adb)")")")"
    if [[ -d "$candidate/platform-tools" ]]; then
      echo "$candidate"
      return 0
    fi
  fi
}

ensure_android_sdk_configured() {
  local sdk_home local_properties
  sdk_home="$(find_android_sdk_home || true)"
  if [[ -z "$sdk_home" ]]; then
    echo "Android SDK not found. Expected one of:" >&2
    echo "  $HOME/android-sdk, $HOME/Android/Sdk, /opt/android-sdk" >&2
    echo "Or set ANDROID_HOME/ANDROID_SDK_ROOT before running." >&2
    exit 1
  fi

  export ANDROID_HOME="$sdk_home"
  export ANDROID_SDK_ROOT="$sdk_home"
  echo "Using ANDROID_HOME=$ANDROID_HOME"

  local_properties="$ANDROID_DIR/local.properties"
  printf "sdk.dir=%s\n" "$sdk_home" > "$local_properties"
}

download_portable_jdk17() {
  local arch os api_arch url download_dir archive_path target_dir
  arch="$(uname -m)"
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"

  case "$arch" in
    x86_64|amd64)
      api_arch="x64"
      ;;
    aarch64|arm64)
      api_arch="aarch64"
      ;;
    *)
      echo "Unsupported CPU architecture for auto JDK download: $arch" >&2
      return 1
      ;;
  esac

  if [[ "$os" != "linux" ]]; then
    echo "Auto JDK download is currently configured for Linux only." >&2
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to auto-download JDK." >&2
    return 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required to extract downloaded JDK." >&2
    return 1
  fi

  download_dir="$JDK_CACHE_DIR"
  target_dir="$download_dir/temurin-17-${api_arch}"
  archive_path="$download_dir/temurin-17-${api_arch}.tar.gz"
  url="https://api.adoptium.net/v3/binary/latest/17/ga/${os}/${api_arch}/jdk/hotspot/normal/eclipse"

  if [[ -x "$target_dir/bin/java" ]]; then
    echo "$target_dir"
    return 0
  fi

  mkdir -p "$download_dir"
  echo "Downloading portable JDK 17..." >&2
  curl -fsSL "$url" -o "$archive_path"

  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  tar -xzf "$archive_path" -C "$target_dir" --strip-components=1
  rm -f "$archive_path"

  if [[ ! -x "$target_dir/bin/java" ]]; then
    echo "Downloaded JDK is invalid at $target_dir" >&2
    return 1
  fi

  echo "$target_dir"
}

ensure_java_for_android_gradle() {
  local current_java major
  current_java="${JAVA_HOME:-}/bin/java"
  if [[ -z "${JAVA_HOME:-}" || ! -x "$current_java" ]]; then
    if ! command -v java >/dev/null 2>&1; then
      echo "Java is not installed. Please install JDK 17 (recommended)."
      exit 1
    fi
    current_java="$(command -v java)"
  fi

  major="$(java_major_version "$current_java")"
  if java_major_in_supported_range_for_android "$major"; then
    return
  fi

  local best_jdk_home
  best_jdk_home="$(find_best_supported_jdk_home || true)"
  if [[ -n "$best_jdk_home" ]]; then
    export JAVA_HOME="$best_jdk_home"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "Using JAVA_HOME=$JAVA_HOME"
    return
  fi

  best_jdk_home="$(download_portable_jdk17 || true)"
  if [[ -n "$best_jdk_home" && -x "$best_jdk_home/bin/java" ]]; then
    export JAVA_HOME="$best_jdk_home"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "Using JAVA_HOME=$JAVA_HOME"
    return
  fi

  echo "Found Java $major, but this Android build requires JDK 17-24."
  echo "Could not auto-provision a portable JDK."
  echo "Install JDK 17 (recommended), then retry."
  if command -v pacman >/dev/null 2>&1; then
    echo "Arch Linux: sudo pacman -S --needed jdk17-openjdk && export JAVA_HOME=/usr/lib/jvm/java-17-openjdk"
  else
    echo "Example: export JAVA_HOME=/path/to/jdk-17"
  fi
  exit 1
}

run_expo_prebuild_android() {
  if [[ "${SKIP_EXPO_PREBUILD:-}" == "1" ]]; then
    echo "Skipping Expo prebuild (SKIP_EXPO_PREBUILD=1)"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to run Expo prebuild." >&2
    exit 1
  fi
  # Use npx so this works with local Expo installs.
  (cd "$MOBILE_DIR" && npx expo prebuild -p android) >/dev/null
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

MODE="${1:-gradle}"

if [[ "$MODE" == "gradle" ]]; then
  BUILD_TYPE="${2:-debug}"
  if [[ "$BUILD_TYPE" != "debug" && "$BUILD_TYPE" != "release" ]]; then
    echo "Invalid build type: $BUILD_TYPE"
    echo "Use debug or release."
    exit 1
  fi

  run_expo_prebuild_android

  if [[ ! -d "$ANDROID_DIR" ]]; then
    echo "Android project not found at $ANDROID_DIR"
    exit 1
  fi

  if [[ ! -x "$ANDROID_DIR/gradlew" ]]; then
    echo "gradlew not found/executable at $ANDROID_DIR/gradlew"
    exit 1
  fi

  cd "$ANDROID_DIR"
  ensure_java_for_android_gradle
  ensure_android_sdk_configured

  if [[ "$BUILD_TYPE" == "release" ]]; then
    ./gradlew assembleRelease
    APK_CANDIDATES=(
      "$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
      "$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
    )
  else
    ./gradlew assembleDebug
    APK_CANDIDATES=(
      "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
    )
  fi

  APK_PATH=""
  for candidate in "${APK_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      APK_PATH="$candidate"
      break
    fi
  done

  if [[ -z "$APK_PATH" ]]; then
    echo "APK not found after Gradle build."
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  OUT_PATH="$OUT_DIR/mobile-${BUILD_TYPE}-${TIMESTAMP}.apk"
  cp "$APK_PATH" "$OUT_PATH"

  echo "APK built: $APK_PATH"
  echo "Copied to: $OUT_PATH"
  exit 0
fi

echo "Unknown mode: $MODE"
usage
exit 1
