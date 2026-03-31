import { access } from "node:fs/promises"
import { delimiter, join } from "node:path"
import process from "node:process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type {
  DeviceReadinessState,
  DslogicDeviceIdentity,
  InventoryDiagnostic,
  InventoryDiagnosticCode,
  InventoryPlatform
} from "@listenai/contracts"

const execFileAsync = promisify(execFile)

export const DSLOGIC_PROVIDER_KIND = "dslogic" as const
export const DSLOGIC_BACKEND_KIND = "dsview" as const
export const DSLOGIC_BACKEND_EXECUTABLE = "dsview"
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const

export type DslogicProbeBackendState =
  | "ready"
  | "missing"
  | "timeout"
  | "failed"
  | "malformed"
  | "unsupported-os"

export interface DslogicProbeDiagnostic {
  code: InventoryDiagnosticCode
  message: string
  deviceId?: string
  executablePath?: string | null
  backendVersion?: string | null
}

export interface DslogicProbeDeviceCandidate {
  deviceId: string
  label: string
  lastSeenAt: string | null
  capabilityType?: string
  usbVendorId: string | null
  usbProductId: string | null
  model?: string | null
  modelDisplayName?: string | null
  variantHint?: string | null
}

export interface DslogicBackendProbeSnapshot {
  platform: InventoryPlatform
  checkedAt: string
  backend: {
    state: DslogicProbeBackendState
    executablePath: string | null
    version: string | null
  }
  devices: readonly DslogicProbeDeviceCandidate[]
  diagnostics: readonly DslogicProbeDiagnostic[]
}

export interface DslogicBackendProbe {
  probeInventory(): Promise<DslogicBackendProbeSnapshot>
}

export interface CreateDslogicBackendProbeOptions {
  now?: () => string
  getHostPlatform?: () => NodeJS.Platform
  locateExecutable?: (command: string) => Promise<string | null>
  runCommand?: (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number }
  ) => Promise<{ stdout: string; stderr: string }>
  listUsbDevices?: () => Promise<readonly DslogicProbeDeviceCandidate[]>
  timeoutMs?: number
}

export interface ClassifiedDslogicCandidate {
  identity: DslogicDeviceIdentity
  readiness: DeviceReadinessState
  diagnostics: readonly InventoryDiagnostic[]
}

const DEFAULT_TIMEOUT_MS = 1500

const normalizeUsbIdentifier = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}

export const resolveInventoryPlatform = (
  platform: NodeJS.Platform | string
): InventoryPlatform => {
  switch (platform) {
    case "darwin":
    case "macos":
      return "macos"
    case "win32":
    case "windows":
      return "windows"
    default:
      return "linux"
  }
}

const parseVersionFromOutput = (output: string): string | null => {
  const normalized = output.trim()
  if (normalized.length === 0) {
    return null
  }

  const match = normalized.match(/\d+(?:\.\d+)+(?:[-+][^\s]+)?/)
  if (match) {
    return match[0]
  }

  return null
}

const createBackendDiagnostic = (
  snapshot: DslogicBackendProbeSnapshot,
  code: InventoryDiagnosticCode,
  message: string
): InventoryDiagnostic => ({
  code,
  severity: code === "backend-probe-timeout" ? "warning" : "error",
  target: "backend",
  message,
  platform: snapshot.platform,
  backendKind: DSLOGIC_BACKEND_KIND,
  executablePath: snapshot.backend.executablePath,
  backendVersion: snapshot.backend.version
})

export const mapBackendProbeDiagnostics = (
  snapshot: DslogicBackendProbeSnapshot
): InventoryDiagnostic[] => {
  const diagnostics = snapshot.diagnostics.map((diagnostic) =>
    createBackendDiagnostic(snapshot, diagnostic.code, diagnostic.message)
  )

  if (diagnostics.length > 0) {
    return diagnostics
  }

  switch (snapshot.backend.state) {
    case "missing":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-missing-executable",
          `DSView executable ${DSLOGIC_BACKEND_EXECUTABLE} was not found on ${snapshot.platform}.`
        )
      ]
    case "timeout":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-timeout",
          `DSView probe timed out before readiness was confirmed on ${snapshot.platform}.`
        )
      ]
    case "failed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-failed",
          `DSView probe failed on ${snapshot.platform}.`
        )
      ]
    case "malformed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-malformed-output",
          `DSView probe returned malformed output on ${snapshot.platform}.`
        )
      ]
    case "unsupported-os":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-unsupported-os",
          `DSView probing is not supported on ${snapshot.platform}.`
        )
      ]
    default:
      return []
  }
}

export const classifyDslogicCandidate = (
  candidate: DslogicProbeDeviceCandidate
): ClassifiedDslogicCandidate => {
  const usbVendorId = normalizeUsbIdentifier(candidate.usbVendorId)
  const usbProductId = normalizeUsbIdentifier(candidate.usbProductId)
  const model = candidate.model ?? "dslogic-plus"
  const fallbackLabel = candidate.label.trim().length > 0 ? candidate.label : "DSLogic device"
  const modelDisplayName = candidate.modelDisplayName ?? fallbackLabel

  const baseIdentity: DslogicDeviceIdentity = {
    family: "dslogic",
    model,
    modelDisplayName,
    variant: candidate.variantHint ?? null,
    usbVendorId,
    usbProductId
  }

  if (usbVendorId === "2a0e" && usbProductId === "0001") {
    return {
      identity: {
        ...baseIdentity,
        model: "dslogic-plus",
        modelDisplayName: candidate.modelDisplayName ?? "DSLogic Plus",
        variant: "classic"
      },
      readiness: "ready",
      diagnostics: []
    }
  }

  if (usbVendorId === "2a0e" && usbProductId === "0030") {
    return {
      identity: {
        ...baseIdentity,
        model: "dslogic-plus",
        modelDisplayName: candidate.modelDisplayName ?? "DSLogic V421/Pango",
        variant: "v421-pango"
      },
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Variant V421/Pango (2a0e:0030) is not supported.",
          deviceId: candidate.deviceId,
          backendKind: DSLOGIC_BACKEND_KIND
        }
      ]
    }
  }

  const unknownVariant = [usbVendorId, usbProductId].filter(Boolean).join(":") || "missing-usb-id"

  return {
    identity: {
      ...baseIdentity,
      variant: candidate.variantHint ?? unknownVariant
    },
    readiness: "unsupported",
    diagnostics: [
      {
        code: "device-probe-malformed-output",
        severity: "warning",
        target: "device",
        message: `Unable to classify DSLogic variant ${unknownVariant}.`,
        deviceId: candidate.deviceId,
        backendKind: DSLOGIC_BACKEND_KIND
      }
    ]
  }
}

const defaultLocateExecutable = async (command: string): Promise<string | null> => {
  const pathValue = process.env.PATH ?? ""
  const pathEntries = pathValue.split(delimiter).filter(Boolean)
  const pathext = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean)
    : [""]

  for (const entry of pathEntries) {
    for (const extension of pathext) {
      const candidatePath = process.platform === "win32"
        ? join(entry, `${command}${extension.toLowerCase()}`)
        : join(entry, command)

      try {
        await access(candidatePath)
        return candidatePath
      } catch {
        continue
      }
    }
  }

  return null
}

const defaultRunCommand: NonNullable<CreateDslogicBackendProbeOptions["runCommand"]> = async (
  command,
  args,
  options
) => {
  const result = await execFileAsync(command, [...args], {
    timeout: options.timeoutMs,
    windowsHide: true
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr
  }
}

const defaultListUsbDevices: NonNullable<CreateDslogicBackendProbeOptions["listUsbDevices"]> = async () => []

export const createDslogicBackendProbe = (
  options: CreateDslogicBackendProbeOptions = {}
): DslogicBackendProbe => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostPlatform = options.getHostPlatform ?? (() => process.platform)
  const locateExecutable = options.locateExecutable ?? defaultLocateExecutable
  const runCommand = options.runCommand ?? defaultRunCommand
  const listUsbDevices = options.listUsbDevices ?? defaultListUsbDevices
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async probeInventory(): Promise<DslogicBackendProbeSnapshot> {
      const checkedAt = now()
      const platform = resolveInventoryPlatform(getHostPlatform())
      const devices = await listUsbDevices()
      const baseSnapshot: DslogicBackendProbeSnapshot = {
        platform,
        checkedAt,
        backend: {
          state: DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(platform)
            ? "missing"
            : "unsupported-os",
          executablePath: null,
          version: null
        },
        devices,
        diagnostics: []
      }

      if (!DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(platform)) {
        return {
          ...baseSnapshot,
          backend: {
            ...baseSnapshot.backend,
            state: "unsupported-os"
          }
        }
      }

      const executablePath = await locateExecutable(DSLOGIC_BACKEND_EXECUTABLE)
      if (!executablePath) {
        return {
          ...baseSnapshot,
          backend: {
            ...baseSnapshot.backend,
            state: "missing"
          }
        }
      }

      try {
        const { stdout, stderr } = await runCommand(executablePath, ["--version"], {
          timeoutMs
        })
        const version = parseVersionFromOutput(`${stdout}\n${stderr}`)

        if (!version) {
          return {
            ...baseSnapshot,
            backend: {
              state: "malformed",
              executablePath,
              version: null
            }
          }
        }

        return {
          ...baseSnapshot,
          backend: {
            state: "ready",
            executablePath,
            version
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return {
            ...baseSnapshot,
            backend: {
              state: "timeout",
              executablePath,
              version: null
            }
          }
        }

        return {
          ...baseSnapshot,
          backend: {
            state: "failed",
            executablePath,
            version: null
          }
        }
      }
    }
  }
}
