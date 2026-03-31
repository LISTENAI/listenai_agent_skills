#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/generic-skill.test.ts
pnpm --filter @listenai/skill-logic-analyzer typecheck
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
