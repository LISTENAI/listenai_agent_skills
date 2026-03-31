#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

run_layer() {
  local layer_id="$1"
  local description="$2"
  shift 2

  echo
  echo "==> [${layer_id}] ${description}"

  if "$@"; then
    echo "<== [${layer_id}] pass"
  else
    local exit_code=$?
    echo "<== [${layer_id}] fail (exit ${exit_code})" >&2
    echo "Layer ${layer_id} failed: ${description}" >&2
    return "${exit_code}"
  fi
}

run_layer \
  "S01-dashboard-contract" \
  "Dashboard projection and route truth remain aligned" \
  pnpm --dir "$ROOT_DIR" run verify:m007:s01

run_layer \
  "S02-runtime-startup" \
  "Real resource-manager startup serves browser, API, SSE, and LAN path" \
  pnpm --dir "$ROOT_DIR" run verify:m007:s02

run_layer \
  "S03-runtime-alignment" \
  "Live runtime mutations stay aligned across API truth and client-visible state" \
  pnpm --dir "$ROOT_DIR" exec vitest run integration/resource-manager.e2e.test.ts integration/resource-manager-dashboard.e2e.test.ts

echo

echo "M007 S04 verification passed: dashboard contract, real runtime startup, and live truth alignment all hold."
