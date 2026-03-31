import type {
  DashboardSnapshot,
  InventorySnapshot,
  LeaseInfo
} from "@listenai/contracts";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "./dashboard-snapshot.js";

const refreshedAt = "2026-03-31T04:00:00.000Z";
const nowMs = Date.parse("2026-03-31T04:00:20.000Z");

const inventory: InventorySnapshot = {
  providerKind: "dslogic",
  backendKind: "dsview",
  refreshedAt,
  devices: [
    {
      deviceId: "device-b",
      label: "Allocated but lease missing",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "allocated",
      ownerSkillId: "skill-from-device",
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "degraded",
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "device",
          message: "Capture path is slower than expected.",
          deviceId: "device-b",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "device-a",
      label: "Healthy allocated device",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "allocated",
      ownerSkillId: "stale-device-owner",
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "device-c",
      label: "Disconnected device",
      capabilityType: "logic-analyzer",
      connectionState: "disconnected",
      allocationState: "allocated",
      ownerSkillId: "device-c-owner",
      lastSeenAt: "2026-03-31T03:58:00.000Z",
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "device-d",
      label: "Unsupported but free",
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
          message: "Unsupported hardware variant.",
          deviceId: "device-d",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
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
          message: "DSView is not installed.",
          platform: "macos",
          backendKind: "dsview"
        }
      ]
    },
    {
      platform: "linux",
      backendKind: "dsview",
      readiness: "degraded",
      executablePath: "/usr/bin/dsview",
      version: "1.0.0",
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "backend",
          message: "Probe returned slowly.",
          platform: "linux",
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
      message: "DSView is not installed.",
      platform: "macos",
      backendKind: "dsview"
    }
  ]
};

const leases: LeaseInfo[] = [
  {
    leaseId: "lease-a",
    deviceId: "device-a",
    ownerSkillId: "skill-from-lease",
    createdAt: "2026-03-31T03:59:00.000Z",
    lastRefreshedAt: "2026-03-31T04:00:10.000Z"
  },
  {
    leaseId: "lease-c",
    deviceId: "device-c",
    ownerSkillId: "lease-c-owner",
    createdAt: "2026-03-31T03:58:00.000Z",
    lastRefreshedAt: "2026-03-31T03:58:30.000Z"
  },
  {
    leaseId: "lease-orphan",
    deviceId: "device-orphan",
    ownerSkillId: "skill-orphan",
    createdAt: "2026-03-31T03:57:00.000Z",
    lastRefreshedAt: "2026-03-31T04:00:00.000Z"
  }
];

const buildSnapshot = (): DashboardSnapshot =>
  createDashboardSnapshot(
    inventory,
    {
      getAllLeases: () => leases,
      getTimeoutMs: () => 30000
    },
    {
      now: () => nowMs,
      expiringSoonThresholdMs: 20000
    }
  );

describe("createDashboardSnapshot", () => {
  it("joins authoritative inventory and leases into stable detail rows", () => {
    const snapshot = buildSnapshot();

    expect(snapshot.devices.map((device) => device.deviceId)).toEqual([
      "device-a",
      "device-b",
      "device-c",
      "device-d"
    ]);

    expect(snapshot.devices[0]).toMatchObject({
      deviceId: "device-a",
      readinessBadge: "ready",
      occupancyState: "occupied",
      owner: {
        skillId: "skill-from-lease",
        source: "lease"
      },
      lease: {
        state: "active",
        leaseId: "lease-a",
        expiresAt: "2026-03-31T04:00:40.000Z",
        remainingMs: 20000,
        timeoutMs: 30000
      }
    });

    expect(snapshot.devices[1]).toMatchObject({
      deviceId: "device-b",
      readinessBadge: "degraded",
      occupancyState: "lease-missing",
      owner: {
        skillId: "skill-from-device",
        source: "device"
      },
      lease: {
        state: "missing",
        leaseId: null,
        remainingMs: null,
        timeoutMs: null
      }
    });

    expect(snapshot.devices[2]).toMatchObject({
      deviceId: "device-c",
      readinessBadge: "disconnected",
      occupancyState: "lease-overdue",
      owner: {
        skillId: "lease-c-owner",
        source: "lease"
      },
      lease: {
        state: "overdue",
        leaseId: "lease-c",
        expiresAt: "2026-03-31T03:59:00.000Z",
        remainingMs: -80000
      }
    });

    expect(snapshot.devices[3]).toMatchObject({
      deviceId: "device-d",
      readinessBadge: "unsupported",
      occupancyState: "available",
      owner: null,
      lease: {
        state: "none",
        leaseId: null
      }
    });
  });

  it("summarizes overview metrics for occupancy, lease timing, and backend readiness", () => {
    const snapshot = buildSnapshot();

    expect(snapshot.overview).toEqual({
      totalDevices: 4,
      connectedDevices: 3,
      disconnectedDevices: 1,
      availableDevices: 1,
      occupiedDevices: 3,
      readyDevices: 1,
      degradedDevices: 1,
      unsupportedDevices: 1,
      activeLeases: 3,
      overdueLeases: 1,
      missingLeases: 1,
      orphanedLeases: 1,
      expiringSoon: 1,
      backendReady: 0,
      backendDegraded: 1,
      backendMissing: 1,
      backendUnsupported: 0
    });
  });

  it("does not fabricate device rows for backend-only or orphaned-lease state", () => {
    const snapshot = createDashboardSnapshot(
      {
        ...inventory,
        devices: [],
        backendReadiness: inventory.backendReadiness.slice(0, 1)
      },
      {
        getAllLeases: () => leases,
        getTimeoutMs: () => 30000
      },
      { now: () => nowMs }
    );

    expect(snapshot.devices).toEqual([]);
    expect(snapshot.overview.totalDevices).toBe(0);
    expect(snapshot.overview.orphanedLeases).toBe(3);
    expect(snapshot.overview.backendMissing).toBe(1);
  });
});
