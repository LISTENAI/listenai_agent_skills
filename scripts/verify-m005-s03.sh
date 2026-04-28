#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

run_layer() {
  local label="$1"
  shift

  echo "[verify-m005-s03] ${label}"
  "$@" || {
    local status=$?
    echo "[verify-m005-s03] ${label} failed with exit ${status}" >&2
    exit "$status"
  }
}

run_layer \
  "resource-client capture/decode HTTP parser guards" \
  pnpm --filter @listenai/eaw-resource-client exec vitest run src/http-resource-manager.test.ts

run_layer \
  "connected UART capture-decode integration proof" \
  pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts

run_layer \
  "installed skill package asset contract and installer guards" \
  pnpm --filter @listenai/eaw-skill-logic-analyzer exec vitest run \
    src/package-asset-contract.test.ts \
    src/codex-skill-installer.test.ts \
    src/claude-skill-installer.test.ts \
    src/shared-skill-installer.test.ts \
    src/host-skill-install-cli.test.ts

run_layer \
  "resource-client typecheck" \
  pnpm --filter @listenai/eaw-resource-client run typecheck

run_layer \
  "skill package typecheck" \
  pnpm --filter @listenai/eaw-skill-logic-analyzer run typecheck

run_layer \
  "skill package build" \
  pnpm --filter @listenai/eaw-skill-logic-analyzer run build

run_layer "installed/public guidance grep guard" python3 - <<'PY'
from pathlib import Path
import re

GUIDANCE_FILES = [
    Path("packages/skill-logic-analyzer/README.md"),
    Path("packages/skill-logic-analyzer/SKILL.md"),
    Path("docs/logic-analyzer-agent-skill.md"),
    Path("docs/logic-analyzer-agent-skill.zh-CN.md"),
]

REQUIRED_MARKERS = [
    "HttpResourceManager",
    "listDecoderCapabilities",
    "captureDecode",
    "/capture/decode",
    "1:uart",
]

FORBIDDEN_PATTERNS = [
    re.compile(r"\b(?:run|invoke|execute|call|use|shell out to)\s+`?dsview-cli\s+capture\b", re.I),
    re.compile(r"\bdsview-cli\s+capture\b[^.\n]*(?:live|connected|UART|protocol-log|protocol log)", re.I),
    re.compile(r"(?:live|connected|UART|protocol-log|protocol log)[^.\n]*\bdsview-cli\s+capture\b", re.I),
]

NEGATED_PATTERN = re.compile(
    r"(?:do not|don't|never|not|instead of|rather than)[^.\n]*\bdsview-cli\s+capture\b|"
    r"\bdsview-cli\s+capture\b[^.\n]*(?:instead of|rather than)",
    re.I,
)

for path in GUIDANCE_FILES:
    content = path.read_text()
    missing = [marker for marker in REQUIRED_MARKERS if marker not in content]
    if missing:
        raise SystemExit(
            f"{path}: missing required connected capture-decode markers: {', '.join(missing)}"
        )

    for sentence in re.split(r"(?<=[.!?])\s+|\n+", content):
        if not sentence.strip() or NEGATED_PATTERN.search(sentence):
            continue
        for pattern in FORBIDDEN_PATTERNS:
            match = pattern.search(sentence)
            if match:
                raise SystemExit(
                    f"{path}: forbidden direct live dsview-cli capture guidance: {match.group(0)}"
                )

print("[verify-m005-s03] guidance markers and direct-live-capture guards passed")
PY

echo "[verify-m005-s03] Codex-safe capture-decode guidance acceptance seam passed"
