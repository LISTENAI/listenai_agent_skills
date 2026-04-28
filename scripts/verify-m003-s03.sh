#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$(mktemp -d)"
PORT=""
trap 'if [[ -n "${PORT}" ]]; then node "$ROOT_DIR/packages/resource-manager/dist/cli.js" stop --state-dir "$STATE_DIR" --json >/dev/null 2>&1 || true; fi; rm -rf "$STATE_DIR"' EXIT

cd "$ROOT_DIR"

echo "[m003-s03] Building resource-manager"
pnpm --filter @listenai/resource-manager build

PORT="$(node -e "const s=require('node:net').createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port); s.close();});")"
CLI="$ROOT_DIR/packages/resource-manager/dist/cli.js"

echo "[m003-s03] Starting daemon on 127.0.0.1:${PORT}"
START_JSON="$(node "$CLI" start --daemon --provider fake --host 127.0.0.1 --port "$PORT" --state-dir "$STATE_DIR" --readyTimeoutMs 5000 --json)"
echo "$START_JSON"

node --input-type=module - "$START_JSON" "$PORT" <<'NODE'
const [raw, expectedPort] = process.argv.slice(2);
const status = JSON.parse(raw);
if (status.status !== "running") throw new Error(`expected running start status, got ${status.status}`);
if (status.health !== "ok") throw new Error(`expected health ok, got ${status.health}`);
if (status.provider !== "fake") throw new Error(`expected fake provider, got ${status.provider}`);
if (String(status.port) !== String(expectedPort)) throw new Error(`expected port ${expectedPort}, got ${status.port}`);
if (!status.pid || status.pid <= 0) throw new Error("expected positive daemon pid");
if (!status.stateFile || !status.logFile) throw new Error("expected state and log paths");
NODE

STATUS_JSON="$(node "$CLI" status --state-dir "$STATE_DIR" --json)"
echo "$STATUS_JSON"
node --input-type=module - "$STATUS_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "running") throw new Error(`expected running status, got ${status.status}`);
if (status.health !== "ok") throw new Error(`expected health ok, got ${status.health}`);
NODE

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null

STOP_JSON="$(node "$CLI" stop --state-dir "$STATE_DIR" --json)"
echo "$STOP_JSON"
node --input-type=module - "$STOP_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "stopped") throw new Error(`expected stopped status, got ${status.status}`);
NODE

STOP_AGAIN_JSON="$(node "$CLI" stop --state-dir "$STATE_DIR" --json)"
echo "$STOP_AGAIN_JSON"
node --input-type=module - "$STOP_AGAIN_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "stopped") throw new Error(`expected idempotent stopped status, got ${status.status}`);
NODE

STATUS_STOPPED_JSON="$(node "$CLI" status --state-dir "$STATE_DIR" --json)"
echo "$STATUS_STOPPED_JSON"
node --input-type=module - "$STATUS_STOPPED_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "stopped") throw new Error(`expected stopped status after stop, got ${status.status}`);
NODE

echo "[m003-s03] Resource-manager daemon lifecycle verification passed"
