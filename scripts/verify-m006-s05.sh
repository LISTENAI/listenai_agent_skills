#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer exec vitest run \
  src/generic-skill.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/resource-manager exec vitest run \
  src/dslogic/dslogic-device-provider.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer typecheck
pnpm --dir "$ROOT_DIR" exec vitest run integration/logic-analyzer-http.e2e.test.ts
