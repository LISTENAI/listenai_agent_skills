#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" --filter @listenai/eaw-resource-manager typecheck
pnpm --dir "$ROOT_DIR" --filter @listenai/eaw-resource-manager exec vitest run \
  src/server/dashboard-snapshot.test.ts \
  src/server/app.test.ts
