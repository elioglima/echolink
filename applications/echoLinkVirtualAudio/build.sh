#!/usr/bin/env sh
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

if [ ! -d EchoLinkVirtualAudio.xcodeproj ]; then
  echo "EchoLinkVirtualAudio.xcodeproj nao encontrado. Execute a partir de applications/echoLinkVirtualAudio."
  exit 1
fi

configuration="${CONFIGURATION:-Release}"
mkdir -p build

xcodebuild \
  -project EchoLinkVirtualAudio.xcodeproj \
  -configuration "$configuration" \
  -target EchoLinkVirtualAudio \
  CONFIGURATION_BUILD_DIR="$root/build" \
  build

echo "Build concluido: $root/build/EchoLinkVirtualAudio.driver"
