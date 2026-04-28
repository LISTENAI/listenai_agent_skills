#!/usr/bin/env bash
set -euo pipefail

REGISTRY_URL="${LISTENAI_NPM_REGISTRY_URL:-https://registry-lpm.listenai.com}"
AUTH_MODE="${LISTENAI_NPM_AUTH_MODE:-password}"
TMP_DIR="$(mktemp -d)"
NPM_USERCONFIG="$TMP_DIR/npmrc"
trap 'rm -rf "$TMP_DIR"' EXIT

usage() {
  cat <<'EOF'
Usage: scripts/check-lpm-auth.sh

Checks local npm authentication against the ListenAI private registry.
This script does not publish packages and does not write registry config into the repo.

Environment:
  LISTENAI_NPM_REGISTRY_URL   Registry URL. Defaults to https://registry-lpm.listenai.com
  LISTENAI_NPM_AUTH_MODE      password or token. Defaults to password.

Password mode requires:
  LPM_PASSWORD_BASE64         npm _password value
  LPM_USERNAME                npm username
  LPM_EMAIL                   npm email

Token mode requires:
  LPM_ADMIN_TOKEN             npm auth token
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$AUTH_MODE" != "password" && "$AUTH_MODE" != "token" ]]; then
  echo "[lpm-auth] LISTENAI_NPM_AUTH_MODE must be password or token, got '$AUTH_MODE'" >&2
  exit 2
fi

REGISTRY_AUTH_HOST="${REGISTRY_URL#http://}"
REGISTRY_AUTH_HOST="${REGISTRY_AUTH_HOST#https://}"
REGISTRY_AUTH_HOST="${REGISTRY_AUTH_HOST%/}"

printf '@listenai:registry=%s\n' "$REGISTRY_URL" > "$NPM_USERCONFIG"

if [[ "$AUTH_MODE" == "password" ]]; then
  if [[ -z "${LPM_PASSWORD_BASE64:-}" || -z "${LPM_USERNAME:-}" || -z "${LPM_EMAIL:-}" ]]; then
    echo "[lpm-auth] password mode requires LPM_PASSWORD_BASE64, LPM_USERNAME, and LPM_EMAIL." >&2
    exit 2
  fi
  printf '//%s/:_password=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_PASSWORD_BASE64" >> "$NPM_USERCONFIG"
  printf '//%s/:username=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_USERNAME" >> "$NPM_USERCONFIG"
  printf '//%s/:email=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_EMAIL" >> "$NPM_USERCONFIG"
  printf '//%s/:always-auth=true\n' "$REGISTRY_AUTH_HOST" >> "$NPM_USERCONFIG"
else
  if [[ -z "${LPM_ADMIN_TOKEN:-}" ]]; then
    echo "[lpm-auth] token mode requires LPM_ADMIN_TOKEN." >&2
    exit 2
  fi
  printf '//%s/:_authToken=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_ADMIN_TOKEN" >> "$NPM_USERCONFIG"
  printf '//%s/:always-auth=true\n' "$REGISTRY_AUTH_HOST" >> "$NPM_USERCONFIG"
fi

echo "[lpm-auth] Registry: $REGISTRY_URL"
echo "[lpm-auth] Auth mode: $AUTH_MODE"
echo "[lpm-auth] Running npm whoami"

if whoami_output="$(npm whoami --registry "$REGISTRY_URL" --userconfig "$NPM_USERCONFIG" 2>&1)"; then
  echo "[lpm-auth] Authentication OK: $whoami_output"
else
  status=$?
  echo "[lpm-auth] Authentication failed with exit code $status" >&2
  echo "$whoami_output" >&2
  exit "$status"
fi
