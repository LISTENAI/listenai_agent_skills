#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT_DIR"

echo "[m003-s01] Building publishable packages"
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
    echo "[m003-s01] Missing expected tar entry: $entry in $tarball" >&2
    return 1
  fi
}

reject_tar_prefix() {
  local tarball="$1"
  local prefix="$2"
  local entries
  entries="$(tar -tf "$tarball")"
  if grep -q "^${prefix}" <<<"$entries"; then
    echo "[m003-s01] Unexpected tar entry prefix: $prefix in $tarball" >&2
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
  local package_dir="$2"
  shift 2
  local pack_dir="$TMP_DIR/${package_name//@/}" # safe enough for temp diagnostics
  mkdir -p "$pack_dir"

  echo "[m003-s01] Packing $package_name"
  pnpm --filter "$package_name" pack --pack-destination "$pack_dir" >/dev/null
  local tarball
  tarball="$(find "$pack_dir" -maxdepth 1 -type f -name '*.tgz' | sort | tail -n 1)"
  if [[ -z "$tarball" ]]; then
    echo "[m003-s01] No tarball produced for $package_name" >&2
    return 1
  fi

  require_tar_entry "$tarball" "package/package.json"
  require_tar_entry "$tarball" "package/dist/index.js"
  require_tar_entry "$tarball" "package/dist/index.d.ts"
  reject_tar_prefix "$tarball" "package/src/"

  for entry in "$@"; do
    require_tar_entry "$tarball" "$entry"
  done

  verify_internal_deps "$tarball" "$package_name"
  echo "[m003-s01] Verified $package_name -> $tarball"
}

pack_and_verify "@listenai/eaw-contracts" "share/contracts"
pack_and_verify "@listenai/eaw-resource-client" "share/resource-client"
pack_and_verify "@listenai/eaw-resource-manager" "packages/resource-manager" \
  "package/dist/cli.js" \
  "package/README.md" \
  "package/README.zh-CN.md"
pack_and_verify "@listenai/eaw-skill-logic-analyzer" "packages/skill-logic-analyzer" \
  "package/dist/claude-skill-install-cli.js" \
  "package/dist/codex-skill-install-cli.js" \
  "package/SKILL.md" \
  "package/README.md"

echo "[m003-s01] Package publish surface verification passed"
