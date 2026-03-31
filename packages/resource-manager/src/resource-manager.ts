import type {
  AllocationRequest,
  AllocationResult,
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot,
  LiveCaptureFailure,
  LiveCaptureRequest,
  LiveCaptureResult,
  ReleaseRequest,
  ReleaseResult,
  SnapshotResourceManager
} from "@listenai/contracts";
import { captureDslogicLive } from "./dslogic/live-capture.js";
import type {
  DslogicLiveCaptureRunner
} from "./dslogic/live-capture.js";
import type { DeviceProvider } from "./device-provider.js";

export type { ResourceManager, SnapshotResourceManager } from "@listenai/contracts";

export interface ResourceManagerOptions {
  now?: () => string;
  liveCaptureRunner?: DslogicLiveCaptureRunner;
}

interface AllocationStateSnapshot {
  ownerSkillId: string;
  allocatedAt: string;
}

const EMPTY_SNAPSHOT: InventorySnapshot = {
  providerKind: "fake",
  backendKind: "fake",
  refreshedAt: "1970-01-01T00:00:00.000Z",
  devices: [],
  backendReadiness: [],
  diagnostics: []
};

const buildAuthoritativeSessionFailure = (
  request: LiveCaptureRequest,
  message: string,
  details: readonly string[]
): LiveCaptureFailure => ({
  ok: false,
  reason: "capture-failed",
  kind: "unsupported-runtime",
  message,
  session: request.session,
  requestedAt: request.requestedAt,
  artifactSummary: null,
  diagnostics: {
    phase: "validate-session",
    providerKind: request.session.device.providerKind ?? null,
    backendKind: request.session.device.backendKind ?? null,
    executablePath: null,
    command: [],
    timeoutMs: request.timeoutMs ?? null,
    exitCode: null,
    signal: null,
    stdout: null,
    stderr: null,
    details,
    diagnostics: request.session.device.diagnostics ?? []
  }
});

const cloneDiagnostic = (
  diagnostic: InventoryDiagnostic
): InventoryDiagnostic => ({ ...diagnostic });

const cloneRecord = (record: DeviceRecord): DeviceRecord => ({
  ...record,
  diagnostics: record.diagnostics?.map(cloneDiagnostic),
  dslogic: record.dslogic ? { ...record.dslogic } : record.dslogic
});

const cloneSnapshot = (snapshot: InventorySnapshot): InventorySnapshot => ({
  ...snapshot,
  devices: snapshot.devices.map(cloneRecord),
  backendReadiness: snapshot.backendReadiness.map((record) => ({
    ...record,
    diagnostics: record.diagnostics.map(cloneDiagnostic)
  })),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
});

const sortDevices = (devices: Iterable<DeviceRecord>): DeviceRecord[] =>
  Array.from(devices, cloneRecord).sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId)
  );

const setAllocationState = (
  record: DeviceRecord,
  allocation: AllocationStateSnapshot | undefined,
  updatedAt: string,
  connectionState: DeviceRecord["connectionState"] = record.connectionState
): DeviceRecord => ({
  ...cloneRecord(record),
  connectionState,
  allocationState: allocation ? "allocated" : "free",
  ownerSkillId: allocation?.ownerSkillId ?? null,
  updatedAt
});

const createDisconnectedAllocatedRecord = (
  record: DeviceRecord,
  allocation: AllocationStateSnapshot,
  updatedAt: string
): DeviceRecord =>
  setAllocationState(record, allocation, updatedAt, "disconnected");

export class InMemoryResourceManager implements SnapshotResourceManager {
  readonly #provider: DeviceProvider;
  readonly #now: () => string;
  readonly #liveCaptureRunner?: DslogicLiveCaptureRunner;
  readonly #allocations = new Map<string, AllocationStateSnapshot>();
  #snapshot: InventorySnapshot = cloneSnapshot(EMPTY_SNAPSHOT);

  constructor(provider: DeviceProvider, options: ResourceManagerOptions = {}) {
    this.#provider = provider;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#liveCaptureRunner = options.liveCaptureRunner;
  }

  async refreshInventory(): Promise<readonly DeviceRecord[]> {
    const snapshot = await this.refreshInventorySnapshot();
    return sortDevices(snapshot.devices);
  }

  async refreshInventorySnapshot(): Promise<InventorySnapshot> {
    const providerSnapshot = cloneSnapshot(await this.#provider.listInventorySnapshot());
    const updatedAt = this.#now();
    const nextDevices = new Map<string, DeviceRecord>();

    for (const discovered of providerSnapshot.devices) {
      const allocation = this.#allocations.get(discovered.deviceId);
      nextDevices.set(
        discovered.deviceId,
        setAllocationState(discovered, allocation, updatedAt)
      );
    }

    for (const [deviceId, allocation] of this.#allocations) {
      if (nextDevices.has(deviceId)) {
        continue;
      }

      const previousRecord = this.#findStoredDevice(deviceId);
      if (!previousRecord) {
        continue;
      }

      nextDevices.set(
        deviceId,
        createDisconnectedAllocatedRecord(previousRecord, allocation, updatedAt)
      );
    }

    this.#snapshot = {
      ...providerSnapshot,
      refreshedAt: updatedAt,
      devices: Array.from(nextDevices.values())
    };

    return cloneSnapshot(this.#snapshot);
  }

  async listDevices(): Promise<readonly DeviceRecord[]> {
    return sortDevices(this.#snapshot.devices);
  }

  async getInventorySnapshot(): Promise<InventorySnapshot> {
    return cloneSnapshot(this.#snapshot);
  }

  async allocateDevice(request: AllocationRequest): Promise<AllocationResult> {
    const device = this.#findStoredDevice(request.deviceId);
    if (!device) {
      return {
        ok: false,
        reason: "device-not-found",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not present in inventory.`,
        device: null
      };
    }

    if (device.connectionState === "disconnected") {
      return {
        ok: false,
        reason: "device-disconnected",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is disconnected and cannot be allocated.`,
        device: cloneRecord(device)
      };
    }

    if (device.allocationState === "allocated") {
      if (device.ownerSkillId === request.ownerSkillId) {
        return {
          ok: true,
          device: cloneRecord(device)
        };
      }

      return {
        ok: false,
        reason: "device-already-allocated",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is already allocated to ${device.ownerSkillId}.`,
        device: cloneRecord(device)
      };
    }

    const updatedDevice: DeviceRecord = {
      ...cloneRecord(device),
      allocationState: "allocated",
      ownerSkillId: request.ownerSkillId,
      updatedAt: request.requestedAt
    };

    this.#allocations.set(request.deviceId, {
      ownerSkillId: request.ownerSkillId,
      allocatedAt: request.requestedAt
    });
    this.#setStoredDevice(updatedDevice);

    return {
      ok: true,
      device: cloneRecord(updatedDevice)
    };
  }

  async releaseDevice(request: ReleaseRequest): Promise<ReleaseResult> {
    const device = this.#findStoredDevice(request.deviceId);
    if (!device) {
      return {
        ok: false,
        reason: "device-not-found",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not present in inventory.`,
        device: null
      };
    }

    if (device.allocationState !== "allocated" || !device.ownerSkillId) {
      return {
        ok: false,
        reason: "device-not-allocated",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not currently allocated.`,
        device: cloneRecord(device)
      };
    }

    if (device.ownerSkillId !== request.ownerSkillId) {
      return {
        ok: false,
        reason: "owner-mismatch",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is allocated to ${device.ownerSkillId}, not ${request.ownerSkillId}.`,
        device: cloneRecord(device)
      };
    }

    const releasedDevice: DeviceRecord = {
      ...cloneRecord(device),
      allocationState: "free",
      ownerSkillId: null,
      updatedAt: request.releasedAt
    };

    this.#allocations.delete(request.deviceId);

    if (releasedDevice.connectionState === "disconnected") {
      this.#deleteStoredDevice(request.deviceId);
    } else {
      this.#setStoredDevice(releasedDevice);
    }

    return {
      ok: true,
      device: cloneRecord(releasedDevice)
    };
  }

  async liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult> {
    const authoritativeDevice = this.#findStoredDevice(request.session.deviceId);
    if (!authoritativeDevice) {
      return buildAuthoritativeSessionFailure(
        request,
        `Cannot capture from unknown device ${request.session.deviceId}.`,
        [
          `Device ${request.session.deviceId} is not present in authoritative inventory.`,
          "Accepted sessions must target a device that is still visible to the resource manager."
        ]
      );
    }

    if (
      authoritativeDevice.allocationState !== "allocated" ||
      authoritativeDevice.ownerSkillId !== request.session.ownerSkillId
    ) {
      return buildAuthoritativeSessionFailure(
        request,
        `Cannot capture from device ${request.session.deviceId} for owner ${request.session.ownerSkillId}.`,
        [
          `Authoritative allocation state is ${authoritativeDevice.allocationState}.`,
          `Authoritative owner is ${authoritativeDevice.ownerSkillId ?? "unowned"}.`,
          "Live capture requests must use the currently allocated owner for the accepted session."
        ]
      );
    }

    if (!this.#liveCaptureRunner) {
      return buildAuthoritativeSessionFailure(
        request,
        "Live capture runner is not configured for the resource manager.",
        [
          "Provide ResourceManagerOptions.liveCaptureRunner when constructing the in-memory manager."
        ]
      );
    }

    return captureDslogicLive(
      {
        ...request,
        session: {
          ...request.session,
          device: cloneRecord(authoritativeDevice)
        }
      },
      {
        runner: this.#liveCaptureRunner
      }
    );
  }

  #findStoredDevice(deviceId: string): DeviceRecord | undefined {
    return this.#snapshot.devices.find((record) => record.deviceId === deviceId);
  }

  #setStoredDevice(record: DeviceRecord): void {
    const nextDevices = this.#snapshot.devices.filter(
      (candidate) => candidate.deviceId !== record.deviceId
    );
    nextDevices.push(cloneRecord(record));
    this.#snapshot = {
      ...this.#snapshot,
      devices: nextDevices
    };
  }

  #deleteStoredDevice(deviceId: string): void {
    this.#snapshot = {
      ...this.#snapshot,
      devices: this.#snapshot.devices.filter((record) => record.deviceId !== deviceId)
    };
  }
}

export const createResourceManager = (
  provider: DeviceProvider,
  options?: ResourceManagerOptions
): SnapshotResourceManager => new InMemoryResourceManager(provider, options);
