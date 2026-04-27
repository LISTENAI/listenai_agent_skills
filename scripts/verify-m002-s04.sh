#!/usr/bin/env bash
set -euo pipefail

echo "[verify-m002-s04] stale skill hardcoding guard"
if rg -n "DSLOGIC_PLUS_SAMPLE_RATE_TIERS" packages/skill-logic-analyzer/src; then
  echo "[verify-m002-s04] stale DSLOGIC_PLUS_SAMPLE_RATE_TIERS authority found in skill source" >&2
  exit 1
fi
if rg -n "(sampleRateHz|sample-rate|sample rate).*(100_000_000|200_000_000|400_000_000|500_000_000|1_000_000_000|100000000|200000000|400000000|500000000|1000000000|100MHz|200MHz|400MHz|500MHz|1GHz)" \
  packages/skill-logic-analyzer/src/contracts.ts \
  packages/skill-logic-analyzer/src/session-constraints.ts \
  packages/skill-logic-analyzer/src/generic-skill.ts \
  packages/skill-logic-analyzer/src/logic-analyzer-skill.ts; then
  echo "[verify-m002-s04] direct DSLogic Plus sample-rate tier constants found in skill validation" >&2
  exit 1
fi

echo "[verify-m002-s04] contracts typecheck"
pnpm --filter @listenai/contracts typecheck

echo "[verify-m002-s04] resource-manager DSLogic/resource/server tests"
pnpm --filter @listenai/resource-manager exec vitest run \
  src/resource-manager.test.ts \
  src/server/app.test.ts \
  src/dslogic/native-runtime.test.ts \
  src/dslogic/live-capture.test.ts

echo "[verify-m002-s04] resource-client HTTP parser tests"
pnpm --filter @listenai/resource-client exec vitest run src/http-resource-manager.test.ts

echo "[verify-m002-s04] skill logic analyzer tests"
pnpm --filter @listenai/skill-logic-analyzer exec vitest run \
  src/session-constraints.test.ts \
  src/logic-analyzer-skill.test.ts \
  src/generic-skill.test.ts

echo "[verify-m002-s04] HTTP integration tests"
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
