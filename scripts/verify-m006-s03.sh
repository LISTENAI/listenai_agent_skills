#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @listenai/resource-manager exec vitest run ./src/dslogic/live-capture.test.ts
pnpm --filter @listenai/resource-manager typecheck
pnpm --filter @listenai/resource-manager exec vitest run src/server/app.test.ts
pnpm --filter @listenai/resource-client exec vitest run src/http-resource-manager.test.ts
pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/logic-analyzer-skill.test.ts
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
