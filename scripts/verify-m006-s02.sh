#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" --filter @listenai/resource-client exec vitest run \
  src/http-resource-manager.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer exec vitest run \
  src/session-constraints.test.ts \
  src/logic-analyzer-skill.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer typecheck
pnpm --dir "$ROOT_DIR" exec vitest run integration/logic-analyzer-http.e2e.test.ts
