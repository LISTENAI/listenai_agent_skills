import type { InventorySnapshot } from "@listenai/eaw-contracts"
import type { DeviceProvider, DiscoveredDevice } from "../device-provider.js"
import { FakeDeviceProvider } from "../testing/fake-device-provider.js"
import {
  DslogicDeviceProvider,
  type DslogicDeviceProviderOptions
} from "./dslogic-device-provider.js"

export interface CreateDeviceProviderOptions {
  providerKind?: "fake" | "dslogic"
  fakeInventory?: readonly DiscoveredDevice[] | InventorySnapshot
  dslogic?: DslogicDeviceProviderOptions
}

export const createDeviceProvider = (
  options: CreateDeviceProviderOptions = {}
): DeviceProvider => {
  if (options.providerKind === "fake") {
    return new FakeDeviceProvider(options.fakeInventory)
  }

  return new DslogicDeviceProvider(options.dslogic)
}
