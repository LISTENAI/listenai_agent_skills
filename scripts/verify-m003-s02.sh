#!/usr/bin/env bash
set -euo pipefail

require_pattern() {
  local pattern="$1"
  shift
  if ! rg -q "$pattern" "$@"; then
    echo "[m003-s02] Missing pattern '$pattern' in $*" >&2
    return 1
  fi
}

reject_pattern() {
  local pattern="$1"
  shift
  if rg -q "$pattern" "$@"; then
    echo "[m003-s02] Unexpected pattern '$pattern' in $*" >&2
    rg -n "$pattern" "$@" >&2
    return 1
  fi
}

ROOT_DOCS=(README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md)
PACKAGE_DOCS=(packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md)
ALL_DOCS=("${ROOT_DOCS[@]}" "${PACKAGE_DOCS[@]}")

require_pattern "registry-lpm\.listenai\.com" "${ALL_DOCS[@]}"
require_pattern "npm exec --package @listenai/eaw-skill-logic-analyzer" README.md docs/logic-analyzer-agent-skill.md packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md
require_pattern "pnpm dlx --package @listenai/eaw-skill-logic-analyzer" README.md docs/logic-analyzer-agent-skill.md packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md
require_pattern "yarn dlx @listenai/eaw-skill-logic-analyzer" README.md docs/logic-analyzer-agent-skill.md packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md
require_pattern "npm install -g @listenai/eaw-resource-manager" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
require_pattern "resource-manager start --daemon" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
require_pattern "resource-manager status --json" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
require_pattern "resource-manager stop" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
require_pattern "global singleton|全局单实例|user-home singleton|用户 home" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
reject_pattern "npm exec --package @listenai/eaw-resource-manager|pnpm dlx --package @listenai/eaw-resource-manager|yarn dlx @listenai/eaw-resource-manager" README.md README.zh-CN.md docs/logic-analyzer-agent-skill.md docs/logic-analyzer-agent-skill.zh-CN.md packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md
require_pattern "contributor|贡献者|source workspace|源码 workspace" "${ROOT_DOCS[@]}"
require_pattern "listenai\.skillAssets" packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md
reject_pattern 'wired to `src/cli\.ts`|指向 `src/cli\.ts`' packages/resource-manager/README.md packages/resource-manager/README.zh-CN.md

echo "[m003-s02] Docs registry-first verification passed"
