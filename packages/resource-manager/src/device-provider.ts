import type { InventorySnapshot } from "@listenai/contracts";

export interface DiscoveredDevice {
  deviceId: string;
  label: string;
  capabilityType: string;
  lastSeenAt: string;
}

export interface DeviceProvider {
  listInventorySnapshot(): Promise<InventorySnapshot>;
  listConnectedDevices(): Promise<readonly DiscoveredDevice[]>;
}
