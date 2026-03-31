# @listenai/resource-manager

<h4 align="right"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></h4>

This package owns the resource-manager runtime surface for the workspace. It exports the in-memory manager, HTTP app/server helpers, lease management, DSLogic provider integration, and a CLI that starts the HTTP server.

If you are trying to use the server from this repository, start here instead of inferring behavior from the repo root.

## What this package exposes

Use the package root as the canonical import surface:

```ts
import {
  InMemoryResourceManager,
  LeaseManager,
  createApp,
  createServer,
  createDeviceProvider,
  type SnapshotResourceManager
} from "@listenai/resource-manager";
```

The package also ships a CLI bin named `resource-manager`, wired to `src/cli.ts`.

## Prerequisites

- Node.js 22
- pnpm 10.33.0
- `pnpm install --frozen-lockfile` run from the repository root in a fresh workspace

## Start the server from the repository

From the repository root, the most direct development command is:

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

CLI options:

- `--host`, `-h`: bind host, defaults to `127.0.0.1`
- `--port`, `-p`: bind port, defaults to `7600`
- `--provider`: device provider, `dslogic` by default, `fake` for local smoke tests

The CLI also reads `RESOURCE_MANAGER_PROVIDER`; if both are present, the CLI flag wins.

Examples:

```bash
# Default DSLogic-backed startup
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts

# Force the fake provider for local liveness and route smoke checks
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --provider fake --host 127.0.0.1 --port 7600

# Equivalent provider selection through env
RESOURCE_MANAGER_PROVIDER=fake pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --port 7600
```

When startup succeeds, the process logs `Server listening on http://<host>:<port>`.

## Health and inventory checks

Use these endpoints after the server is up.

### Basic liveness

```bash
curl http://127.0.0.1:7600/health
```

Expected shape:

```json
{"status":"ok","timestamp":"2026-03-31T05:00:00.000Z"}
```

### Full inventory snapshot

Returns the authoritative snapshot, including backend readiness and device diagnostics.

```bash
curl http://127.0.0.1:7600/inventory
```

### Refresh and return the full snapshot

```bash
curl -X POST http://127.0.0.1:7600/inventory/refresh
```

Call this once after startup if you want the in-memory manager to pull the provider's current inventory into its authoritative snapshot immediately.

### Compatibility device list

Returns only device rows.

```bash
curl http://127.0.0.1:7600/devices
curl -X POST http://127.0.0.1:7600/refresh
```

Immediately after startup, `/devices` reflects the manager's current authoritative snapshot, which starts empty until the first refresh. If you expect provider-backed devices, call `POST /refresh` first.

Use `/inventory` and `/inventory/refresh` when you need backend readiness and diagnostics. Use `/devices` and `/refresh` when the caller only understands the device-list compatibility surface.

When the CLI runs with `--provider fake`, the default inventory is empty. That mode is useful for liveness and route smoke checks, but allocation examples below need either:

- a real device ID returned by `/devices` when using the default `dslogic` provider, or
- a programmatically seeded fake provider, shown later in this README

## Lease and allocation flow

The server keeps a lease table alongside device allocation state.

### Allocate a device

```bash
curl -X POST http://127.0.0.1:7600/allocate \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceId": "<device-id-from-/devices>",
    "ownerSkillId": "logic-analyzer",
    "requestedAt": "2026-03-31T05:01:00.000Z"
  }'
```

Success returns `200` plus the accepted device, `leaseId`, and `expiresAt`.

Allocation failures return `409`, including cases such as:

- `device-not-found`
- `device-already-allocated`

### Heartbeat an active lease

```bash
curl -X POST http://127.0.0.1:7600/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"leaseId":"<lease-id-from-allocate>"}'
```

Success returns `200` with a refreshed `expiresAt`. Unknown leases return `404` with `reason: "lease-not-found"`.

### Inspect leases

```bash
curl http://127.0.0.1:7600/leases
```

### Release a device

```bash
curl -X POST http://127.0.0.1:7600/release \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceId": "<device-id-from-/devices>",
    "ownerSkillId": "logic-analyzer",
    "releasedAt": "2026-03-31T05:02:00.000Z"
  }'
```

Success returns `200` and removes the matching lease. Release mismatches return `400`, including wrong-owner attempts.

## Live capture route

The HTTP surface also exposes live capture through the shared contracts:

```bash
curl -X POST http://127.0.0.1:7600/capture/live \
  -H 'Content-Type: application/json' \
  -d '{
    "session": {
      "sessionId": "session-1",
      "deviceId": "logic-1",
      "ownerSkillId": "logic-analyzer",
      "startedAt": "2026-03-31T05:01:00.000Z",
      "device": {
        "deviceId": "logic-1",
        "label": "Logic 1",
        "capabilityType": "logic-analyzer",
        "connectionState": "connected",
        "allocationState": "allocated",
        "ownerSkillId": "logic-analyzer",
        "lastSeenAt": "2026-03-31T05:00:00.000Z",
        "updatedAt": "2026-03-31T05:01:00.000Z",
        "readiness": "ready",
        "diagnostics": [],
        "providerKind": "dslogic",
        "backendKind": "dsview"
      },
      "sampling": {
        "sampleRateHz": 1000000,
        "captureDurationMs": 4,
        "channels": [{ "channelId": "D0", "label": "CLK" }]
      }
    },
    "requestedAt": "2026-03-31T05:01:10.000Z",
    "timeoutMs": 1500
  }'
```

For real capture payloads, prefer building requests from the shared `@listenai/contracts` types or the `@listenai/resource-client` HTTP client rather than hand-writing large JSON bodies.

## Programmatic startup

If you need to embed the HTTP surface in another process, build the manager and server directly. This example seeds a fake device so allocation, heartbeat, and release flows are available without DSLogic hardware:

```ts
import {
  InMemoryResourceManager,
  LeaseManager,
  createDeviceProvider,
  createServer
} from "@listenai/resource-manager";

const provider = createDeviceProvider({
  providerKind: "fake",
  fakeInventory: [
    {
      deviceId: "fake-audio-1",
      label: "Fake Audio 1",
      capabilityType: "audio",
      lastSeenAt: new Date().toISOString()
    }
  ]
});
const manager = new InMemoryResourceManager(provider);
await manager.refreshInventory();
const leaseManager = new LeaseManager();

const server = createServer({
  host: "127.0.0.1",
  port: 7600,
  manager,
  leaseManager
});

const startInfo = await server.start();
console.log(startInfo.url);

// later
server.stop();
```

`start()` resolves to `{ host, port, url }`. `stop()` shuts down the HTTP server and the background lease-expiry scan.

## Operational notes

- The default provider is `dslogic`; use `--provider fake` when you only need to verify the HTTP surface.
- The server scans for expired leases every 10 seconds by default and releases matching devices automatically.
- `SIGINT` and `SIGTERM` trigger a clean stop in the packaged CLI.
- `GET /health` is liveness only. For backend readiness, inspect `/inventory`.

## Verification

Focused package checks:

```bash
pnpm --filter @listenai/resource-manager test
pnpm --filter @listenai/resource-manager typecheck
```

Repo-level verification paths that also exercise this package:

```bash
pnpm run test
pnpm run verify:s06
pnpm run verify:s07
```
