#!/usr/bin/env bash
# Run only the Debug simulator product, in a new disposable simulator sandbox.
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$IOS_ROOT/build/DerivedData/Build/Products/Debug-iphonesimulator/DaguanPad.app"
OUT="$IOS_ROOT/build/simulator-smoke"
BUNDLE_ID='fun.kaoyangogogo.DaguanPad'
DEVICE=''
if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'WKWebView simulator smoke requires macOS and Xcode.' >&2
  exit 1
fi
for tool in xcrun python3; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
[[ -d "$APP" ]] || { printf 'Missing Debug simulator app: %s\n' "$APP" >&2; exit 1; }
mkdir -p "$OUT"
MARKER="daguan-smoke-$(python3 -c 'import uuid; print(uuid.uuid4())')"
export SMOKE_OUT="$OUT" SMOKE_MARKER="$MARKER"
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$DEVICE" ]]; then
    xcrun simctl spawn "$DEVICE" log show --last 5m --style compact \
      --predicate 'process == "DaguanPad" OR process == "com.apple.WebKit.WebContent"' \
      > "$OUT/simulator.log" 2>&1 || true
    xcrun simctl terminate "$DEVICE" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl shutdown "$DEVICE" >> "$OUT/cleanup.log" 2>&1 || true
    xcrun simctl delete "$DEVICE" >> "$OUT/cleanup.log" 2>&1 || true
  fi
  if [[ "$status" != 0 ]]; then
    SMOKE_EXIT="$status" python3 - <<'PY'
import json, os, pathlib
out = pathlib.Path(os.environ['SMOKE_OUT'])
(out / 'runner-failure.json').write_text(json.dumps({
    'ok': False, 'exitCode': int(os.environ['SMOKE_EXIT']),
    'marker': os.environ['SMOKE_MARKER'],
    'error': 'Simulator smoke failed; inspect phase JSON, launch logs and simulator.log'
}, indent=2) + '\n', encoding='utf-8')
PY
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
xcrun simctl list devices available --json > "$OUT/available-devices.json"
xcrun simctl list runtimes --json > "$OUT/runtimes.json"
xcrun simctl list devicetypes --json > "$OUT/device-types.json"
SMOKE_SDK_VERSION="$(xcrun --sdk iphonesimulator --show-sdk-version)"
export SMOKE_SDK_VERSION
printf '%s\n' "$SMOKE_SDK_VERSION" > "$OUT/sdk-version.txt"
# Select an SDK-compatible iPad/runtime pair, then create our own device. Never boot,
# install into, erase or delete the runner's existing simulators.
python3 - <<'PY' > "$OUT/selection.txt"
import json, os, pathlib
out = pathlib.Path(os.environ['SMOKE_OUT'])
runtimes = {r['identifier']: r for r in json.loads((out / 'runtimes.json').read_text())['runtimes'] if r.get('isAvailable') and '.iOS-' in r['identifier']}
types = json.loads((out / 'device-types.json').read_text())['devicetypes']
by_name = {t['name']: t['identifier'] for t in types if t['name'].startswith('iPad')}
candidates = []
for runtime, devices in json.loads((out / 'available-devices.json').read_text())['devices'].items():
    if runtime not in runtimes:
        continue
    version = tuple(map(int, runtimes[runtime]['version'].split('.')))
    for device in devices:
        if not device.get('isAvailable') or not device['name'].startswith('iPad'):
            continue
        kind = device.get('deviceTypeIdentifier') or by_name.get(device['name'])
        if kind:
            candidates.append((version, kind, runtime))
if not candidates:
    raise SystemExit('No available iPad iOS simulator/runtime pair found')
sdk = tuple(map(int, os.environ['SMOKE_SDK_VERSION'].strip().split('.')))
compatible = [pair for pair in candidates if pair[0][0] == sdk[0]]
if not compatible:
    raise SystemExit(f'No available iPad runtime matching simulator SDK major {sdk[0]}')
exact = [pair for pair in compatible if pair[0][:2] == sdk[:2]]
_, kind, runtime = sorted(exact or compatible)[-1]
print(kind)
print(runtime)
PY
DEVICE_TYPE="$(python3 -c 'import os,pathlib; print((pathlib.Path(os.environ["SMOKE_OUT"])/"selection.txt").read_text().splitlines()[0])')"
RUNTIME="$(python3 -c 'import os,pathlib; print((pathlib.Path(os.environ["SMOKE_OUT"])/"selection.txt").read_text().splitlines()[1])')"
DEVICE="$(xcrun simctl create "$MARKER" "$DEVICE_TYPE" "$RUNTIME")"
printf '%s\n' "$DEVICE" > "$OUT/owned-device.txt"
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b > "$OUT/boot.log" 2>&1
xcrun simctl install "$DEVICE" "$APP" > "$OUT/install.log" 2>&1
run_phase() {
  local phase="$1" container='' result='' attempt
  xcrun simctl launch "$DEVICE" "$BUNDLE_ID" --daguan-smoke "--phase=$phase" "--marker=$MARKER" \
    > "$OUT/$phase-launch.log" 2>&1
  # Native watchdog writes at 120s: cold CI WebKit startup has taken 63s.
  # Allow 30s more for scheduling/collection, checking atomic JSON on 75 polls.
  for ((attempt = 0; attempt < 75; attempt++)); do
    container="$(xcrun simctl get_app_container "$DEVICE" "$BUNDLE_ID" data 2>> "$OUT/$phase-container.log" || true)"
    result="$container/Documents/smoke-result.json"
    if [[ -n "$container" && -f "$result" ]] && python3 - "$result" "$phase" "$MARKER" <<'PY'
import json, sys
try:
    value = json.load(open(sys.argv[1], encoding='utf-8'))
    matches = value.get('phase') == sys.argv[2] and value.get('marker') == sys.argv[3]
except (OSError, ValueError):
    matches = False
sys.exit(0 if matches else 1)
PY
    then
      cp "$result" "$OUT/$phase-result.json"
      python3 - "$OUT/$phase-result.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
print(json.dumps(value, ensure_ascii=False, indent=2))
if value.get('ok') is not True:
    raise SystemExit('WKWebView smoke reported failure')
if not value.get('questionText') or not value.get('stemText') or not value.get('domText'):
    raise SystemExit('Smoke result lacks real rendered DOM evidence')
stages = [entry['stage'] for entry in value.get('stages', [])]
required = ['viewDidLoad', 'configure-ready', 'initial-load-requested', 'navigation-started', 'navigation-finished']
if any(stage not in stages for stage in required):
    raise SystemExit('Smoke result lacks native configure/navigation stage evidence')
PY
      return
    fi
    sleep 2
  done
  printf 'Timed out waiting for %s smoke-result.json (marker %s)\n' "$phase" "$MARKER" >&2
  return 1
}
run_phase write
# Process termination is mandatory: the second launch must re-read native disk.
xcrun simctl terminate "$DEVICE" "$BUNDLE_ID" > "$OUT/cold-terminate.log" 2>&1
run_phase read
python3 - <<'PY'
import json, os, pathlib
out = pathlib.Path(os.environ['SMOKE_OUT'])
write = json.loads((out / 'write-result.json').read_text())
read = json.loads((out / 'read-result.json').read_text())
assert write['marker'] == read['marker'] == os.environ['SMOKE_MARKER']
assert write['questionID'] == read['questionID']
assert write['revisionAfter'] >= write['revisionBefore'] + 2
assert read['revisionBefore'] >= write['revisionAfter']
(out / 'summary.json').write_text(json.dumps({
    'ok': True, 'marker': write['marker'], 'questionID': write['questionID'],
    'writeRevision': write['revisionAfter'], 'coldReadRevision': read['revisionBefore'],
    'writeChecks': len(write['checks']), 'readChecks': len(read['checks'])
}, indent=2) + '\n', encoding='utf-8')
print('Real WKWebView simulator smoke passed: launch, bundled resources, question DOM, native mutations and cold restart restore.')
PY
