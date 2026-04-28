#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @listenai/eaw-resource-manager exec vitest run ./src/dslogic/live-capture.test.ts
pnpm --filter @listenai/eaw-resource-manager typecheck
pnpm --filter @listenai/eaw-resource-manager exec vitest run src/server/app.test.ts
pnpm --filter @listenai/eaw-resource-client exec vitest run src/http-resource-manager.test.ts
pnpm --filter @listenai/eaw-skill-logic-analyzer exec vitest run src/logic-analyzer-skill.test.ts
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
