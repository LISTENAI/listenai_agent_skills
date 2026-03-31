import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ALLOCATION_FAILURE_REASONS,
  ALLOCATION_STATES,
  BACKEND_READINESS_STATES,
  CONNECTION_STATES,
  DEVICE_READINESS_STATES,
  INVENTORY_BACKEND_KINDS,
  INVENTORY_DIAGNOSTIC_CODES,
  INVENTORY_DIAGNOSTIC_SEVERITIES,
  INVENTORY_DIAGNOSTIC_TARGETS,
  INVENTORY_PLATFORMS,
  INVENTORY_PROVIDER_KINDS,
  RELEASE_FAILURE_REASONS,
  FakeDeviceProvider,
  type AllocationFailure,
  type AllocationRequest,
  type AllocationResult,
  type DeviceRecord,
  type InventorySnapshot,
  type ReleaseFailure,
  type ReleaseRequest,
  type ReleaseResult,
  type SnapshotResourceManager,
  createResourceManager
} from "./index.js";

describe("resource manager contract", () => {
  it("exposes visible device state fields on DeviceRecord", () => {
    const record: DeviceRecord = {
      deviceId: "logic-1",
      label: "USB Logic Analyzer",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: "2026-03-25T12:00:00.000Z",
      updatedAt: "2026-03-25T12:00:00.000Z",
      readiness: "ready",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "warning",
          target: "device",
          message: "Variant classification is pending.",
          deviceId: "logic-1",
          backendKind: "dsview"
        }
      ],
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
    };

    expect(record).toEqual({
      deviceId: "logic-1",
      label: "USB Logic Analyzer",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: "2026-03-25T12:00:00.000Z",
      updatedAt: "2026-03-25T12:00:00.000Z",
      readiness: "ready",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "warning",
          target: "device",
          message: "Variant classification is pending.",
          deviceId: "logic-1",
          backendKind: "dsview"
        }
      ],
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
    });
  });

  it("defines explicit allocation, release, and inventory readiness enums", () => {
    expect(ALLOCATION_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-disconnected",
      "device-already-allocated",
      "server-unavailable"
    ]);
    expect(RELEASE_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-not-allocated",
      "owner-mismatch",
      "server-unavailable"
    ]);
    expect(CONNECTION_STATES).toEqual(["connected", "disconnected"]);
    expect(ALLOCATION_STATES).toEqual(["free", "allocated"]);
    expect(DEVICE_READINESS_STATES).toEqual([
      "ready",
      "degraded",
      "unsupported"
    ]);
    expect(BACKEND_READINESS_STATES).toEqual([
      "ready",
      "degraded",
      "missing",
      "unsupported"
    ]);
    expect(INVENTORY_PROVIDER_KINDS).toEqual(["fake", "dslogic"]);
    expect(INVENTORY_BACKEND_KINDS).toEqual(["fake", "dsview", "libsigrok"]);
    expect(INVENTORY_PLATFORMS).toEqual(["linux", "macos", "windows"]);
    expect(INVENTORY_DIAGNOSTIC_SEVERITIES).toEqual([
      "info",
      "warning",
      "error"
    ]);
    expect(INVENTORY_DIAGNOSTIC_TARGETS).toEqual([
      "host",
      "backend",
      "device"
    ]);
    expect(INVENTORY_DIAGNOSTIC_CODES).toEqual([
      "backend-missing-executable",
      "backend-unsupported-os",
      "backend-probe-failed",
      "backend-probe-timeout",
      "backend-probe-malformed-output",
      "device-unsupported-variant",
      "device-probe-malformed-output"
    ]);
  });

  it("keeps request, result, and snapshot contracts discriminated and additive", () => {
    expectTypeOf<AllocationRequest>().toMatchTypeOf<{
      deviceId: string;
      ownerSkillId: string;
      requestedAt: string;
    }>();

    expectTypeOf<ReleaseRequest>().toMatchTypeOf<{
      deviceId: string;
      ownerSkillId: string;
      releasedAt: string;
    }>();

    expectTypeOf<AllocationFailure>().toMatchTypeOf<{
      ok: false;
      reason: string;
      deviceId: string;
      ownerSkillId: string;
      message: string;
      device: DeviceRecord | null;
    }>();

    expectTypeOf<ReleaseFailure>().toMatchTypeOf<{
      ok: false;
      reason: string;
      deviceId: string;
      ownerSkillId: string;
      message: string;
      device: DeviceRecord | null;
    }>();

    expectTypeOf<AllocationResult>().toMatchTypeOf<
      | { ok: true; device: DeviceRecord }
      | { ok: false; reason: string; deviceId: string }
    >();

    expectTypeOf<ReleaseResult>().toMatchTypeOf<
      | { ok: true; device: DeviceRecord }
      | { ok: false; reason: string; deviceId: string }
    >();

    expectTypeOf<InventorySnapshot>().toMatchTypeOf<{
      providerKind: string;
      backendKind: string;
      refreshedAt: string;
      devices: readonly DeviceRecord[];
      backendReadiness: readonly {
        platform: string;
        readiness: string;
        diagnostics: readonly {
          code: string;
          message: string;
        }[];
      }[];
      diagnostics: readonly {
        code: string;
        target: string;
        message: string;
      }[];
    }>();

    expectTypeOf<SnapshotResourceManager>().toMatchTypeOf<{
      refreshInventorySnapshot(): Promise<InventorySnapshot>;
      getInventorySnapshot(): Promise<InventorySnapshot>;
    }>();
  });
});

describe("fake device provider snapshot seam", () => {
  const refreshedAt = "2026-03-25T12:00:00.000Z";

  it("preserves diagnostic-only snapshots when no devices are ready", async () => {
    const diagnosticOnlySnapshot: InventorySnapshot = {
      providerKind: "dslogic",
      backendKind: "dsview",
      refreshedAt,
      devices: [],
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

    const provider = new FakeDeviceProvider(diagnosticOnlySnapshot);

    expect(await provider.listInventorySnapshot()).toEqual(diagnosticOnlySnapshot);
    expect(await provider.listConnectedDevices()).toEqual([]);
  });

  it("keeps degraded and unsupported DSLogic rows visible in the snapshot", async () => {
    const snapshot: InventorySnapshot = {
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
          deviceId: "logic-degraded",
          label: "DSLogic Plus Waiting For Backend",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: refreshedAt,
          updatedAt: refreshedAt,
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-probe-timeout",
              severity: "warning",
              target: "backend",
              message: "Backend probe timed out before capabilities were confirmed.",
              deviceId: "logic-degraded",
              backendKind: "dsview"
            }
          ],
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
          platform: "linux",
          backendKind: "dsview",
          readiness: "ready",
          executablePath: "/usr/bin/dsview",
          version: "1.3.1",
          checkedAt: refreshedAt,
          diagnostics: []
        }
      ],
      diagnostics: []
    };

    const provider = new FakeDeviceProvider(snapshot);

    expect(await provider.listInventorySnapshot()).toEqual(snapshot);
    expect(await provider.listConnectedDevices()).toEqual([
      {
        deviceId: "logic-ready",
        label: "DSLogic Plus Ready",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);
  });

  it("still supports the legacy ready-device constructor and setter", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);

    expect(await provider.listConnectedDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);

    provider.setConnectedDevices([]);

    expect(await provider.listInventorySnapshot()).toEqual({
      providerKind: "fake",
      backendKind: "fake",
      refreshedAt: "1970-01-01T00:00:00.000Z",
      devices: [],
      backendReadiness: [],
      diagnostics: []
    });
  });
});

describe("in-memory resource manager", () => {
  const connectedAt = "2026-03-25T12:00:00.000Z";
  const allocateAt = "2026-03-25T12:01:00.000Z";
  const conflictAt = "2026-03-25T12:01:30.000Z";
  const disconnectAt = "2026-03-25T12:02:00.000Z";
  const releaseAt = "2026-03-25T12:03:00.000Z";

  const baseDevice = {
    deviceId: "logic-1",
    label: "USB Logic Analyzer",
    capabilityType: "logic-analyzer",
    lastSeenAt: connectedAt
  } as const;

  const baseInventoryFields = {
    readiness: "ready",
    diagnostics: [],
    providerKind: "fake",
    backendKind: "fake",
    dslogic: null
  } as const;

  const createClock = (...timestamps: string[]) => {
    let index = 0;

    return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? releaseAt;
  };

  it("refreshes discovered devices into visible inventory records", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const records = await manager.refreshInventory();

    expect(records).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: connectedAt,
        ...baseInventoryFields
      }
    ]);
    expect(await manager.listDevices()).toEqual(records);
  });

  it("transitions a connected device from free to allocated to free", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const allocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    expect(allocation).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    });

    const release = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      releasedAt: releaseAt
    });

    expect(release).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    });
    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("rejects conflicting allocation requests with the owning state still visible", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const firstAllocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });
    const conflictingAllocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-beta",
      requestedAt: conflictAt
    });

    expect(firstAllocation.ok).toBe(true);
    expect(conflictingAllocation).toMatchObject({
      ok: false,
      reason: "device-already-allocated",
      deviceId: "logic-1",
      ownerSkillId: "skill-beta"
    });
    expect(conflictingAllocation.ok).toBe(false);
    if (!conflictingAllocation.ok) {
      expect(conflictingAllocation.message).toContain("skill-alpha");
      expect(conflictingAllocation.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      });
    }

    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("rejects wrong-owner release attempts without hiding the current allocation", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    const releaseResult = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-beta",
      releasedAt: releaseAt
    });

    expect(releaseResult).toMatchObject({
      ok: false,
      reason: "owner-mismatch",
      deviceId: "logic-1",
      ownerSkillId: "skill-beta"
    });
    expect(releaseResult.ok).toBe(false);
    if (!releaseResult.ok) {
      expect(releaseResult.message).toContain("skill-alpha");
      expect(releaseResult.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      });
    }

    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("keeps allocated missing devices visible as disconnected until release", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    provider.setConnectedDevices([]);
    const refreshed = await manager.refreshInventory();

    expect(refreshed).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt,
        ...baseInventoryFields
      }
    ]);

    const releaseResult = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      releasedAt: releaseAt
    });

    expect(releaseResult).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    });
    expect(await manager.listDevices()).toEqual([]);
  });

  it("preserves diagnostics and backend readiness in snapshot methods", async () => {
    const snapshot: InventorySnapshot = {
      providerKind: "dslogic",
      backendKind: "dsview",
      refreshedAt: connectedAt,
      devices: [
        {
          deviceId: "logic-ready",
          label: "DSLogic Plus Ready",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
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
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
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
          checkedAt: connectedAt,
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

    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    expect(await manager.listDevices()).toEqual(snapshot.devices);
    expect(await manager.getInventorySnapshot()).toEqual(snapshot);
    expect(await manager.refreshInventorySnapshot()).toEqual(snapshot);
  });
});
