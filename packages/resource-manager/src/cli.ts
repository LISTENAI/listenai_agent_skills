#!/usr/bin/env node

import { parseArgs } from "node:util"
import { InMemoryResourceManager } from "./resource-manager.js"
import { createServer } from "./server/server.js"
import { LeaseManager } from "./server/lease-manager.js"
import { createDeviceProvider } from "./dslogic/provider-factory.js"

async function main() {
  const { values } = parseArgs({
    options: {
      port: {
        type: "string",
        short: "p",
        default: "7600"
      },
      host: {
        type: "string",
        short: "h",
        default: "0.0.0.0"
      },
      provider: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_PROVIDER ?? "dslogic"
      }
    }
  })

  const port = parseInt(values.port || "7600", 10)
  const host = values.host || "0.0.0.0"
  const providerKind = values.provider === "fake" ? "fake" : "dslogic"

  const provider = createDeviceProvider({ providerKind })
  const manager = new InMemoryResourceManager(provider)
  const leaseManager = new LeaseManager()

  const { start, stop } = createServer({ port, host, manager, leaseManager })

  await start()

  process.on("SIGINT", async () => {
    console.log("SIGINT received, stopping server...")
    stop()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, stopping server...")
    stop()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error("Server failed to start:", error)
  process.exit(1)
})
