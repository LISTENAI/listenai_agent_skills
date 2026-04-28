#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" --filter @listenai/eaw-resource-manager test -- --run \
  dslogic-device-provider.test.ts \
  resource-manager.test.ts \
  app.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/eaw-resource-client test -- --run \
  http-resource-manager.test.ts
pnpm --dir "$ROOT_DIR" exec vitest run integration/resource-manager.e2e.test.ts
