#!/usr/bin/env bash
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-simulator}"
if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'iOS builds require macOS and Xcode.' >&2
  exit 1
fi
for tool in node xcodegen xcodebuild swift; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
node "$IOS_ROOT/scripts/prepare-web.mjs" --replace-generated
(cd "$IOS_ROOT" && swift test && xcodegen generate --spec project.yml)
case "$MODE" in
  simulator)
    xcodebuild -project "$IOS_ROOT/DaguanPad.xcodeproj" -scheme DaguanPad \
      -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$IOS_ROOT/build/DerivedData" CODE_SIGNING_ALLOWED=NO build
    ;;
  device)
    xcodebuild -project "$IOS_ROOT/DaguanPad.xcodeproj" -scheme DaguanPad \
      -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
      -derivedDataPath "$IOS_ROOT/build/DerivedData" -archivePath "$IOS_ROOT/build/DaguanPad.xcarchive" \
      CODE_SIGNING_ALLOWED=NO archive
    mkdir -p "$IOS_ROOT/build/Payload"
    rm -rf "$IOS_ROOT/build/Payload/DaguanPad.app"
    cp -R "$IOS_ROOT/build/DaguanPad.xcarchive/Products/Applications/DaguanPad.app" "$IOS_ROOT/build/Payload/"
    rm -f "$IOS_ROOT/build/DaguanPad-unsigned.new.ipa"
    (cd "$IOS_ROOT/build" && zip -q -r DaguanPad-unsigned.new.ipa Payload)
    mv "$IOS_ROOT/build/DaguanPad-unsigned.new.ipa" "$IOS_ROOT/build/DaguanPad-unsigned.ipa"
    ;;
  *) printf '%s\n' 'Usage: bash ios/build.sh [simulator|device]' >&2; exit 1 ;;
esac
