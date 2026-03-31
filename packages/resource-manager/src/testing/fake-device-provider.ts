import type {
  BackendReadinessRecord,
  DeviceRecord,
  DslogicDeviceIdentity,
  InventoryDiagnostic,
  InventorySnapshot
} from "@listenai/contracts";
import type {
  DeviceProvider,
  DiscoveredDevice
} from "../device-provider.js";

const DEFAULT_REFRESHED_AT = "1970-01-01T00:00:00.000Z";

const cloneDiagnostic = (
  diagnostic: InventoryDiagnostic
): InventoryDiagnostic => ({ ...diagnostic });

const cloneDslogicIdentity = (
  identity: DslogicDeviceIdentity | null | undefined
): DslogicDeviceIdentity | null | undefined =>
  identity ? { ...identity } : identity;

const cloneDeviceRecord = (record: DeviceRecord): DeviceRecord => ({
  ...record,
  diagnostics: record.diagnostics?.map(cloneDiagnostic),
  dslogic: cloneDslogicIdentity(record.dslogic)
});

const cloneBackendReadiness = (
  record: BackendReadinessRecord
): BackendReadinessRecord => ({
  ...record,
  diagnostics: record.diagnostics.map(cloneDiagnostic)
});

const cloneInventorySnapshot = (snapshot: InventorySnapshot): InventorySnapshot => ({
  ...snapshot,
  devices: snapshot.devices.map(cloneDeviceRecord),
  backendReadiness: snapshot.backendReadiness.map(cloneBackendReadiness),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
});

const toDeviceRecord = (device: DiscoveredDevice): DeviceRecord => ({
  deviceId: device.deviceId,
  label: device.label,
  capabilityType: device.capabilityType,
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: device.lastSeenAt,
  updatedAt: device.lastSeenAt,
  readiness: "ready",
  diagnostics: [],
  providerKind: "fake",
  backendKind: "fake",
  dslogic: null
});

const buildSnapshotFromDevices = (
  devices: readonly DiscoveredDevice[]
): InventorySnapshot => {
  const readyDevices = devices.map(toDeviceRecord);
  const refreshedAt =
    readyDevices[0]?.updatedAt ??
    devices[0]?.lastSeenAt ??
    DEFAULT_REFRESHED_AT;

  return {
    providerKind: "fake",
    backendKind: "fake",
    refreshedAt,
    devices: readyDevices,
    backendReadiness: [],
    diagnostics: []
  };
};

const isInventorySnapshot = (
  value: readonly DiscoveredDevice[] | InventorySnapshot
): value is InventorySnapshot =>
  !Array.isArray(value) &&
  typeof value === "object" &&
  value !== null &&
  "devices" in value &&
  "refreshedAt" in value;

const toDiscoveredDevice = (
  record: DeviceRecord,
  refreshedAt: string
): DiscoveredDevice => ({
  deviceId: record.deviceId,
  label: record.label,
  capabilityType: record.capabilityType,
  lastSeenAt: record.lastSeenAt ?? record.updatedAt ?? refreshedAt
});

const isCompatibilityVisible = (record: DeviceRecord): boolean =>
  record.connectionState === "connected" &&
  (record.readiness === undefined || record.readiness === "ready");

export class FakeDeviceProvider implements DeviceProvider {
  #snapshot: InventorySnapshot;

  constructor(initialState: readonly DiscoveredDevice[] | InventorySnapshot = []) {
    this.#snapshot = isInventorySnapshot(initialState)
      ? cloneInventorySnapshot(initialState)
      : buildSnapshotFromDevices(initialState);
  }

  async listInventorySnapshot(): Promise<InventorySnapshot> {
    return cloneInventorySnapshot(this.#snapshot);
  }

  async listConnectedDevices(): Promise<readonly DiscoveredDevice[]> {
    return this.#snapshot.devices
      .filter(isCompatibilityVisible)
      .map((record) => toDiscoveredDevice(record, this.#snapshot.refreshedAt));
  }

  setInventorySnapshot(snapshot: InventorySnapshot): void {
    this.#snapshot = cloneInventorySnapshot(snapshot);
  }

  setConnectedDevices(devices: readonly DiscoveredDevice[]): void {
    this.#snapshot = buildSnapshotFromDevices(devices);
  }
}
