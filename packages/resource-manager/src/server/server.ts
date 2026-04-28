import { serve } from "@hono/node-server";
import type { SnapshotResourceManager } from "@listenai/eaw-contracts";
import type { AddressInfo } from "node:net";
import type { LeaseManager } from "./lease-manager.js";
import { createApp, createDashboardLiveUpdates } from "./app.js";

export interface ServerOptions {
  port: number;
  host: string;
  manager: SnapshotResourceManager;
  leaseManager: LeaseManager;
  scanIntervalMs?: number;
  inventoryPollIntervalMs?: number;
  leaseScanIntervalMs?: number;
}

export interface ServerStartInfo {
  host: string;
  port: number;
  url: string;
}

function toStartInfo(server: { address(): string | AddressInfo | null }, fallbackHost: string): ServerStartInfo {
  const address = server.address();
  if (address && typeof address !== "string") {
    const host = address.address && address.address !== "::" ? address.address : fallbackHost;
    return {
      host,
      port: address.port,
      url: `http://${host}:${address.port}`
    };
  }

  return {
    host: fallbackHost,
    port: 0,
    url: `http://${fallbackHost}:0`
  };
}

function createInventoryChangeFingerprint(
  snapshot: Awaited<ReturnType<SnapshotResourceManager["getInventorySnapshot"]>>
) {
  return JSON.stringify({
    inventoryScope: snapshot.inventoryScope,
    devices: snapshot.devices.map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
      capabilityType: device.capabilityType,
      connectionState: device.connectionState,
      readiness: device.readiness,
      providerKind: device.providerKind ?? null,
      backendKind: device.backendKind ?? null,
      diagnostics: device.diagnostics ?? [],
      canonicalIdentity: device.canonicalIdentity ?? null,
      dslogic: device.dslogic ?? null
    })),
    backendReadiness: snapshot.backendReadiness.map((backend) => ({
      backendKind: backend.backendKind,
      readiness: backend.readiness,
      diagnostics: backend.diagnostics
    })),
    diagnostics: snapshot.diagnostics
  });
}

export function createServer(options: ServerOptions) {
  const dashboardLiveUpdates = createDashboardLiveUpdates(
    options.manager,
    options.leaseManager
  );
  const app = createApp(options.manager, options.leaseManager, {
    dashboardLiveUpdates
  });
  const defaultIntervalMs = options.scanIntervalMs ?? 10000;
  const inventoryPollIntervalMs = options.inventoryPollIntervalMs ?? defaultIntervalMs;
  const leaseScanIntervalMs = options.leaseScanIntervalMs ?? defaultIntervalMs;

  let server: ReturnType<typeof serve> | null = null;
  let inventoryPollInterval: ReturnType<typeof setInterval> | null = null;
  let leaseScanInterval: ReturnType<typeof setInterval> | null = null;
  let lastInventoryFingerprint: string | null = null;

  return {
    async start(): Promise<ServerStartInfo> {
      if (!server) {
        server = serve({
          fetch: app.fetch,
          port: options.port,
          hostname: options.host
        });
      }

      const startInfo = await new Promise<ServerStartInfo>((resolve, reject) => {
        const activeServer = server;
        if (!activeServer) {
          reject(new Error("Server failed to initialize"));
          return;
        }

        const onError = (error: Error) => {
          activeServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          activeServer.off("error", onError);
          resolve(toStartInfo(activeServer, options.host));
        };

        if (activeServer.listening) {
          resolve(toStartInfo(activeServer, options.host));
          return;
        }

        activeServer.once("error", onError);
        activeServer.once("listening", onListening);
      });

      const initialInventory = await options.manager.refreshInventorySnapshot();
      lastInventoryFingerprint = createInventoryChangeFingerprint(initialInventory);

      if (!inventoryPollInterval) {
        inventoryPollInterval = setInterval(() => {
          void options.manager
            .refreshInventorySnapshot()
            .then(async (snapshot) => {
              const nextFingerprint = createInventoryChangeFingerprint(snapshot);
              if (lastInventoryFingerprint !== nextFingerprint) {
                lastInventoryFingerprint = nextFingerprint;
                await dashboardLiveUpdates.publish("inventory-refreshed");
              }
            })
            .catch((error) => {
              console.error("[dashboard-live] failed to refresh inventory:", error);
            });
        }, inventoryPollIntervalMs);
      }

      if (!leaseScanInterval) {
        leaseScanInterval = setInterval(() => {
          const expiredCount = options.leaseManager.scanExpired((lease) => {
            console.log(`Lease expired for device ${lease.deviceId}`);
            void options.manager
              .releaseDevice({
                deviceId: lease.deviceId,
                ownerSkillId: lease.ownerSkillId,
                releasedAt: new Date().toISOString()
              })
              .then(async () => {
                await dashboardLiveUpdates.publish("lease-expired");
              })
              .catch((error) => {
                console.error(
                  `[dashboard-live] failed to release expired lease for ${lease.deviceId}:`,
                  error
                );
              });
          });
          if (expiredCount > 0) {
            console.log(`Released ${expiredCount} expired lease(s)`);
          }
        }, leaseScanIntervalMs);
      }

      console.log(`Server listening on ${startInfo.url}`);
      return startInfo;
    },
    stop() {
      if (inventoryPollInterval) {
        clearInterval(inventoryPollInterval);
        inventoryPollInterval = null;
      }
      if (leaseScanInterval) {
        clearInterval(leaseScanInterval);
        leaseScanInterval = null;
      }
      lastInventoryFingerprint = null;
      dashboardLiveUpdates.close();
      if (server) {
        server.close();
        server = null;
      }
      console.log("Server stopped");
    }
  };
}
