#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PACK_DIR="$TMP_DIR/packs"
CONSUMER_DIR="$TMP_DIR/consumer"
DAEMON_STATE_DIR="$TMP_DIR/daemon-state"
DAEMON_PORT=""
trap 'if [[ -n "${DAEMON_PORT}" && -x "$CONSUMER_DIR/node_modules/.bin/resource-manager" ]]; then "$CONSUMER_DIR/node_modules/.bin/resource-manager" stop --state-dir "$DAEMON_STATE_DIR" --json >/dev/null 2>&1 || true; fi; rm -rf "$TMP_DIR"' EXIT

cd "$ROOT_DIR"
mkdir -p "$PACK_DIR" "$CONSUMER_DIR" "$DAEMON_STATE_DIR"

echo "[m003-s04] Building publishable packages"
pnpm --filter @listenai/eaw-contracts build
pnpm --filter @listenai/eaw-resource-client build
pnpm --filter @listenai/eaw-resource-manager build
pnpm --filter @listenai/eaw-skill-logic-analyzer build

require_tar_entry() {
  local tarball="$1"
  local entry="$2"
  local entries
  entries="$(tar -tf "$tarball")"
  if ! grep -Fxq "$entry" <<<"$entries"; then
    echo "[m003-s04] Missing expected tar entry: $entry in $tarball" >&2
    return 1
  fi
}

reject_tar_prefix() {
  local tarball="$1"
  local prefix="$2"
  local entries
  entries="$(tar -tf "$tarball")"
  if grep -q "^${prefix}" <<<"$entries"; then
    echo "[m003-s04] Unexpected tar entry prefix: $prefix in $tarball" >&2
    grep "^${prefix}" <<<"$entries" >&2
    return 1
  fi
}

verify_internal_deps() {
  local tarball="$1"
  local package_name="$2"
  node --input-type=module - "$tarball" "$package_name" <<'NODE'
import { execFileSync } from "node:child_process";

const [tarball, packageName] = process.argv.slice(2);
const raw = execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" });
const manifest = JSON.parse(raw);
const version = manifest.version;
const deps = manifest.dependencies ?? {};
const internalDeps = Object.entries(deps).filter(([name]) => name.startsWith("@listenai/"));

for (const [name, range] of internalDeps) {
  if (range !== version) {
    throw new Error(`${packageName}: expected ${name} to use exact same-version dependency ${version}, got ${range}`);
  }
}

if (Object.values(deps).some((range) => typeof range === "string" && range.startsWith("workspace:"))) {
  throw new Error(`${packageName}: packed dependencies still contain workspace protocol`);
}
NODE
}

pack_and_verify() {
  local package_name="$1"
  shift
  local package_pack_dir="$PACK_DIR/${package_name//@/}"
  mkdir -p "$package_pack_dir"

  echo "[m003-s04] Packing $package_name" >&2
  pnpm --filter "$package_name" pack --pack-destination "$package_pack_dir" >/dev/null
  local tarball
  tarball="$(find "$package_pack_dir" -maxdepth 1 -type f -name '*.tgz' | sort | tail -n 1)"
  if [[ -z "$tarball" ]]; then
    echo "[m003-s04] No tarball produced for $package_name" >&2
    return 1
  fi

  require_tar_entry "$tarball" "package/package.json"
  require_tar_entry "$tarball" "package/dist/index.js"
  require_tar_entry "$tarball" "package/dist/index.d.ts"
  reject_tar_prefix "$tarball" "package/src/"
  verify_internal_deps "$tarball" "$package_name"

  for entry in "$@"; do
    require_tar_entry "$tarball" "$entry"
  done

  printf '%s\n' "$tarball"
}

CONTRACTS_TGZ="$(pack_and_verify "@listenai/eaw-contracts")"
RESOURCE_CLIENT_TGZ="$(pack_and_verify "@listenai/eaw-resource-client")"
RESOURCE_MANAGER_TGZ="$(pack_and_verify "@listenai/eaw-resource-manager" \
  "package/dist/cli.js" \
  "package/README.md" \
  "package/README.zh-CN.md")"
LOGIC_ANALYZER_TGZ="$(pack_and_verify "@listenai/eaw-skill-logic-analyzer" \
  "package/dist/claude-skill-install-cli.js" \
  "package/dist/codex-skill-install-cli.js" \
  "package/SKILL.md" \
  "package/README.md")"

node --input-type=module - "$CONSUMER_DIR/package.json" "$CONTRACTS_TGZ" "$RESOURCE_CLIENT_TGZ" "$RESOURCE_MANAGER_TGZ" "$LOGIC_ANALYZER_TGZ" <<'NODE'
import { writeFileSync } from "node:fs";

const [manifestPath, contractsTgz, resourceClientTgz, resourceManagerTgz, logicAnalyzerTgz] = process.argv.slice(2);
const manifest = {
  name: "listenai-publish-readiness-consumer",
  private: true,
  type: "module",
  dependencies: {
    "@listenai/eaw-contracts": contractsTgz,
    "@listenai/eaw-resource-client": resourceClientTgz,
    "@listenai/eaw-resource-manager": resourceManagerTgz,
    "@listenai/eaw-skill-logic-analyzer": logicAnalyzerTgz
  },
  pnpm: {
    overrides: {
      "@listenai/eaw-contracts": contractsTgz,
      "@listenai/eaw-resource-client": resourceClientTgz,
      "@listenai/eaw-resource-manager": resourceManagerTgz,
      "@listenai/eaw-skill-logic-analyzer": logicAnalyzerTgz
    }
  }
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cd "$CONSUMER_DIR"
echo "[m003-s04] Installing packed artifacts into temporary consumer"
pnpm install --ignore-scripts

echo "[m003-s04] Verifying installed package manifests and src exclusion"
node --input-type=module <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const packages = [
  "@listenai/eaw-contracts",
  "@listenai/eaw-resource-client",
  "@listenai/eaw-resource-manager",
  "@listenai/eaw-skill-logic-analyzer"
];

for (const packageName of packages) {
  const packageRoot = `node_modules/${packageName}`;
  const manifest = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8"));
  if (existsSync(`${packageRoot}/src`)) {
    throw new Error(`${packageName} installed package unexpectedly contains src/`);
  }
  if (!manifest.exports) {
    throw new Error(`${packageName} missing exports in installed manifest`);
  }
  const deps = manifest.dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (name.startsWith("@listenai/") && range !== manifest.version) {
      throw new Error(`${packageName} installed internal dep ${name} is ${range}, expected ${manifest.version}`);
    }
    if (typeof range === "string" && range.startsWith("workspace:")) {
      throw new Error(`${packageName} installed dependency ${name} still uses workspace protocol`);
    }
  }
}
NODE

echo "[m003-s04] Verifying public exports resolve from installed packages"
node --input-type=module <<'NODE'
import { existsSync, readFileSync } from "node:fs";
import { DSLOGIC_BACKEND_KIND } from "@listenai/eaw-contracts";
import { HttpResourceManager } from "@listenai/eaw-resource-client";
import { createResourceManager } from "@listenai/eaw-resource-manager";
import { createGenericLogicAnalyzerSkill, installCodexSkill, installClaudeSkill } from "@listenai/eaw-skill-logic-analyzer";

if (DSLOGIC_BACKEND_KIND !== "dsview-cli") throw new Error("contracts export smoke failed");
if (typeof HttpResourceManager !== "function") throw new Error("resource-client export smoke failed");
if (typeof createResourceManager !== "function") throw new Error("resource-manager export smoke failed");
if (typeof createGenericLogicAnalyzerSkill !== "function") throw new Error("logic-analyzer generic skill export smoke failed");
if (typeof installCodexSkill !== "function" || typeof installClaudeSkill !== "function") {
  throw new Error("logic-analyzer installer exports failed");
}

const skillText = readFileSync("node_modules/@listenai/eaw-skill-logic-analyzer/SKILL.md", "utf8");
const readmeText = readFileSync("node_modules/@listenai/eaw-skill-logic-analyzer/README.md", "utf8");
if (!skillText.includes("listenai.skillAssets")) throw new Error("installed SKILL.md missing asset metadata guidance");
if (!readmeText.includes("registry-lpm.listenai.com")) throw new Error("installed README missing private registry guidance");
if (!existsSync("node_modules/.bin/listenai-logic-analyzer-install-codex")) throw new Error("missing codex installer bin");
if (!existsSync("node_modules/.bin/listenai-logic-analyzer-install-claude")) throw new Error("missing claude installer bin");
if (!existsSync("node_modules/.bin/resource-manager")) throw new Error("missing resource-manager bin");
NODE

echo "[m003-s04] Verifying installed skill installer bins"
CODEX_TARGET="$TMP_DIR/codex-skills"
CLAUDE_TARGET="$TMP_DIR/claude-skills"
mkdir -p "$CODEX_TARGET" "$CLAUDE_TARGET"
./node_modules/.bin/listenai-logic-analyzer-install-codex "$CODEX_TARGET" >/dev/null
./node_modules/.bin/listenai-logic-analyzer-install-claude "$CLAUDE_TARGET" >/dev/null
test -f "$CODEX_TARGET/logic-analyzer/SKILL.md"
test -f "$CLAUDE_TARGET/logic-analyzer/SKILL.md"

echo "[m003-s04] Verifying installed resource-manager daemon lifecycle"
DAEMON_PORT="$(node -e "const s=require('node:net').createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port); s.close();});")"
START_JSON="$(./node_modules/.bin/resource-manager start --daemon --provider fake --host 127.0.0.1 --port "$DAEMON_PORT" --state-dir "$DAEMON_STATE_DIR" --readyTimeoutMs 5000 --json)"
echo "$START_JSON"
node --input-type=module - "$START_JSON" "$DAEMON_PORT" <<'NODE'
const [raw, expectedPort] = process.argv.slice(2);
const status = JSON.parse(raw);
if (status.status !== "running") throw new Error(`expected running daemon, got ${status.status}`);
if (status.health !== "ok") throw new Error(`expected health ok, got ${status.health}`);
if (status.provider !== "fake") throw new Error(`expected fake provider, got ${status.provider}`);
if (String(status.port) !== String(expectedPort)) throw new Error(`expected daemon port ${expectedPort}, got ${status.port}`);
NODE

curl -fsS "http://127.0.0.1:${DAEMON_PORT}/health" >/dev/null
STATUS_JSON="$(./node_modules/.bin/resource-manager status --state-dir "$DAEMON_STATE_DIR" --json)"
echo "$STATUS_JSON"
node --input-type=module - "$STATUS_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "running") throw new Error(`expected running status, got ${status.status}`);
if (status.health !== "ok") throw new Error(`expected health ok, got ${status.health}`);
NODE

STOP_JSON="$(./node_modules/.bin/resource-manager stop --state-dir "$DAEMON_STATE_DIR" --json)"
echo "$STOP_JSON"
node --input-type=module - "$STOP_JSON" <<'NODE'
const status = JSON.parse(process.argv[2]);
if (status.status !== "stopped") throw new Error(`expected stopped status, got ${status.status}`);
NODE

DAEMON_PORT=""

echo "[m003-s04] Consumer publish-readiness verification passed"
