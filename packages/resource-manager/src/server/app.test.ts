import type { InventorySnapshot } from "@listenai/contracts";
import { describe, expect, it } from "vitest";
import { createResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";
import { createApp } from "./app.js";
import { LeaseManager } from "./lease-manager.js";

const refreshedAt = "2026-03-26T09:00:00.000Z";

const dslogicSnapshot: InventorySnapshot = {
  providerKind: "dslogic",
  backendKind: "dsview",
  refreshedAt,
  devices: [
    {
      deviceId: "logic-ready",
      label: "DSLogic Plus Ready",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001"
      }
    },
    {
      deviceId: "logic-unsupported",
      label: "DSLogic V421/Pango",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Variant V421/Pango is not supported.",
          deviceId: "logic-unsupported",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "v421-pango",
        usbVendorId: "2a0e",
        usbProductId: "0030"
      }
    }
  ],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "missing",
      executablePath: null,
      version: null,
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-missing-executable",
          severity: "error",
          target: "backend",
          message: "DSView was not found on PATH.",
          platform: "macos",
          backendKind: "dsview"
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: "backend-missing-executable",
      severity: "error",
      target: "backend",
      message: "DSView was not found on PATH.",
      platform: "macos",
      backendKind: "dsview"
    }
  ]
};

describe("Hono app routes", () => {
  it("GET /health returns 200 with status and timestamp", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("timestamp");
    expect(typeof body.timestamp).toBe("string");
  });

  it("GET /devices returns empty array initially", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/devices");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /inventory returns backend readiness and device diagnostics intact", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot);
  });

  it("POST /inventory/refresh returns the full snapshot without collapsing metadata", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/inventory/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot);
  });

  it("POST /refresh keeps compatibility fields on device rows derived from the snapshot", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot.devices);
  });

  it("GET /devices returns device rows from backend-only snapshots without fabricating entries", async () => {
    const provider = new FakeDeviceProvider({
      providerKind: "dslogic",
      backendKind: "dsview",
      refreshedAt,
      devices: [],
      backendReadiness: dslogicSnapshot.backendReadiness,
      diagnostics: dslogicSnapshot.diagnostics
    });
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/devices");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /allocate succeeds with 200 and includes leaseId", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill1",
        requestedAt: "2026-03-26T09:01:00.000Z"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.device.allocationState).toBe("allocated");
    expect(body.device.ownerSkillId).toBe("skill1");
    expect(typeof body.leaseId).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("POST /allocate reports expiry from the configured lease timeout", async () => {
    const baseTime = Date.parse("2026-03-26T09:01:00.000Z");
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    const leaseManager = new LeaseManager({
      timeoutMs: 5000,
      now: () => baseTime
    });
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill1",
        requestedAt: "2026-03-26T09:01:00.000Z"
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiresAt).toBe("2026-03-26T09:01:05.000Z");
  });

  it("POST /allocate returns 409 when device already allocated", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill2",
        requestedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("device-already-allocated");
  });

  it("POST /allocate returns 409 when device not found", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "nonexistent",
        ownerSkillId: "skill1",
        requestedAt: "2026-03-26T09:01:00.000Z"
      })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("device-not-found");
  });

  it("POST /release succeeds with 200 and removes lease", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill1",
        releasedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.device.allocationState).toBe("free");
    expect(body.device.ownerSkillId).toBe(null);

    const leasesRes = await app.request("/leases");
    const leases = await leasesRes.json();
    expect(leases).toEqual([]);
  });

  it("POST /release returns 400 when owner mismatch", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill2",
        releasedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("owner-mismatch");
  });

  it("POST /heartbeat with valid leaseId returns 200", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const leaseId = leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.leaseId).toBe(leaseId);
    expect(typeof body.expiresAt).toBe("string");
  });

  it("POST /heartbeat reports expiry from the refreshed lease timestamp", async () => {
    let now = Date.parse("2026-03-26T09:01:00.000Z");
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager({
      timeoutMs: 5000,
      now: () => now
    });
    const leaseId = leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    now += 2000;

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiresAt).toBe("2026-03-26T09:01:07.000Z");
  });

  it("POST /heartbeat with unknown leaseId returns 404", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "unknown-lease-id" })
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("lease-not-found");
    expect(body.leaseId).toBe("unknown-lease-id");
  });

  it("GET /leases returns active leases", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    leaseManager.createLease("dev1", "skill1");
    leaseManager.createLease("dev2", "skill2");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/leases");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("leaseId");
    expect(body[0]).toHaveProperty("deviceId");
    expect(body[0]).toHaveProperty("ownerSkillId");
  });
});
