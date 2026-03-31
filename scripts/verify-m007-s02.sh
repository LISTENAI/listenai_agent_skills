#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${RESOURCE_MANAGER_VERIFY_PORT:-7612}"
SERVER_LOG="$(mktemp -t resource-manager-m007-s02.XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

pnpm --dir "$ROOT_DIR" run verify:m007:s01

pnpm --dir "$ROOT_DIR" --filter @listenai/resource-manager exec tsx src/cli.ts \
  --provider fake \
  --host 0.0.0.0 \
  --port "$PORT" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

RESOURCE_MANAGER_VERIFY_PORT="$PORT" SERVER_LOG="$SERVER_LOG" node <<'NODE'
const fs = require("node:fs/promises");
const os = require("node:os");

const port = Number(process.env.RESOURCE_MANAGER_VERIFY_PORT);
const serverLogPath = process.env.SERVER_LOG;
const loopbackBaseUrl = `http://127.0.0.1:${port}`;

function getLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

async function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected /health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const logOutput = serverLogPath ? await fs.readFile(serverLogPath, "utf8") : "";
  throw new Error(
    `Timed out waiting for resource-manager startup at ${url}. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. Server log:\n${logOutput}`
  );
}

async function expectOk(url, expectedContentType) {
  const response = await fetch(url, {
    headers: expectedContentType === "text/event-stream"
      ? { accept: "text/event-stream" }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`Expected ${url} to return 2xx, got ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes(expectedContentType)) {
    throw new Error(`Expected ${url} to return ${expectedContentType}, got ${contentType || "<missing>"}`);
  }

  return response;
}

async function readSseEvent(url, timeoutMs = 2000) {
  const response = await expectOk(url, "text/event-stream");
  if (!response.body) {
    throw new Error(`${url} returned no SSE body`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt <= timeoutMs) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex);
        if (!rawEvent.startsWith(":") && rawEvent.trim()) {
          const eventName = rawEvent
            .split("\n")
            .find((line) => line.startsWith("event:"))
            ?.slice("event:".length)
            .trim() || "message";
          const data = rawEvent
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trim())
            .join("\n");
          if (data) {
            return {
              event: eventName,
              payload: JSON.parse(data)
            };
          }
        }

        buffer = buffer.slice(separatorIndex + 2);
        continue;
      }

      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timed out waiting for SSE data from ${url}`)), 250);
        })
      ]);

      if (result.done) {
        throw new Error(`${url} closed before an event arrived`);
      }

      buffer += decoder.decode(result.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new Error(`Timed out waiting for a complete SSE event from ${url}`);
}

(async () => {
  await waitForServer(loopbackBaseUrl);

  const dashboardHtml = await expectOk(`${loopbackBaseUrl}/`, "text/html");
  const dashboardBody = await dashboardHtml.text();
  if (!dashboardBody.includes("Single-process dashboard") || !dashboardBody.includes("/dashboard-events")) {
    throw new Error("Dashboard entrypoint did not include the expected same-process live-stream content");
  }

  await expectOk(`${loopbackBaseUrl}/dashboard.js`, "application/javascript");

  const snapshotResponse = await expectOk(`${loopbackBaseUrl}/dashboard-snapshot`, "application/json");
  const snapshot = await snapshotResponse.json();
  if (!snapshot || typeof snapshot !== "object" || !snapshot.overview || !Array.isArray(snapshot.devices)) {
    throw new Error("/dashboard-snapshot did not return the expected dashboard payload shape");
  }

  const initialEvent = await readSseEvent(`${loopbackBaseUrl}/dashboard-events`);
  if (initialEvent.event !== "snapshot" || initialEvent.payload.reason !== "initial") {
    throw new Error(`Expected initial dashboard SSE event, received ${JSON.stringify(initialEvent)}`);
  }

  const lanIpv4 = getLanIpv4();
  if (lanIpv4) {
    const lanHealth = await fetch(`http://${lanIpv4}:${port}/health`);
    if (!lanHealth.ok) {
      throw new Error(`Expected LAN health check via ${lanIpv4} to succeed, got ${lanHealth.status}`);
    }

    const lanDashboard = await fetch(`http://${lanIpv4}:${port}/`);
    const lanBody = await lanDashboard.text();
    if (!lanDashboard.ok || !lanBody.includes("Resource Manager")) {
      throw new Error(`Expected LAN dashboard fetch via ${lanIpv4} to succeed`);
    }
  } else {
    const logOutput = serverLogPath ? await fs.readFile(serverLogPath, "utf8") : "";
    if (!logOutput.includes(`Server listening on http://0.0.0.0:${port}`)) {
      throw new Error("No non-loopback IPv4 interface was available and startup log did not prove 0.0.0.0 binding");
    }
  }
})();
NODE
