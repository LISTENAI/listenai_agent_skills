import { execFile } from "node:child_process"
import process from "node:process"
import type {
  InventoryDiagnosticCode,
  InventoryPlatform,
  LiveCaptureArtifact,
  LiveCaptureFailureKind,
  LiveCaptureFailurePhase,
  LiveCaptureRequest
} from "@listenai/contracts"
import type { DslogicProbeDeviceCandidate } from "./backend-probe.js"

export const DSLOGIC_NATIVE_BACKEND_KIND = "dsview-cli" as const
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const
export const DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS = 3_000
const DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES = 64 * 1024
const DEFAULT_DSVIEW_CLI_PATH = "dsview-cli"

export type DslogicNativeRuntimeState =
  | "ready"
  | "missing"
  | "timeout"
  | "failed"
  | "malformed"
  | "unsupported-os"

export interface DslogicNativeRuntimeDiagnostic {
  code: InventoryDiagnosticCode
  message: string
  deviceId?: string
  // `libraryPath` stays as a compatibility alias while the seam transitions to bundle-aware naming.
  libraryPath?: string | null
  binaryPath?: string | null
  backendVersion?: string | null
}

export interface DslogicNativeHostMetadata {
  platform: InventoryPlatform
  os: NodeJS.Platform | string
  arch: NodeJS.Architecture | string
}

export interface DslogicNativeRuntimeSnapshot {
  checkedAt: string
  host: DslogicNativeHostMetadata
  runtime: {
    state: DslogicNativeRuntimeState
    libraryPath: string | null
    binaryPath?: string | null
    version: string | null
  }
  devices: readonly DslogicProbeDeviceCandidate[]
  diagnostics: readonly DslogicNativeRuntimeDiagnostic[]
}

export interface DslogicNativeRuntime {
  probe(): Promise<DslogicNativeRuntimeSnapshot>
}

export interface DslogicNativeCaptureStreamValue {
  text?: string
  bytes?: Uint8Array
}

export interface DslogicNativeCaptureSuccess {
  ok: true
  backendVersion?: string | null
  diagnosticOutput?: DslogicNativeCaptureStreamValue
  artifact: LiveCaptureArtifact
}

export interface DslogicNativeCaptureFailure {
  ok: false
  kind: Exclude<LiveCaptureFailureKind, "unsupported-runtime">
  phase: Exclude<LiveCaptureFailurePhase, "validate-session">
  message: string
  backendVersion?: string | null
  timeoutMs?: number
  nativeCode?: string | null
  captureOutput?: DslogicNativeCaptureStreamValue
  diagnosticOutput?: DslogicNativeCaptureStreamValue
  details?: readonly string[]
}

export type DslogicNativeCaptureResult =
  | DslogicNativeCaptureSuccess
  | DslogicNativeCaptureFailure

export interface DslogicNativeLiveCaptureBackend {
  capture(request: LiveCaptureRequest): Promise<DslogicNativeCaptureResult>
}

export interface DslogicNativeCommandSuccess {
  ok: true
  stdout: string
  stderr: string
}

export interface DslogicNativeCommandFailure {
  ok: false
  reason: "missing" | "timeout" | "failed"
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  nativeCode: string | number | null
}

export type DslogicNativeCommandResult =
  | DslogicNativeCommandSuccess
  | DslogicNativeCommandFailure

export type DslogicNativeCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    timeoutMs: number
    maxBufferBytes: number
  }
) => Promise<DslogicNativeCommandResult>

interface ParsedDsviewVersion {
  version: string
  binaryPath: string | null
}

export interface CreateDslogicNativeRuntimeOptions {
  now?: () => string
  getHostOs?: () => NodeJS.Platform
  getHostArch?: () => NodeJS.Architecture
  dsviewCliPath?: string
  probeTimeoutMs?: number
  executeCommand?: DslogicNativeCommandRunner
  probeRuntime?: (
    host: DslogicNativeHostMetadata
  ) => Promise<Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics">>
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

const SUPPORTED_HOST_OPERATING_SYSTEMS = new Set<NodeJS.Platform | string>([
  "darwin",
  "macos",
  "linux",
  "win32",
  "windows"
])

const normalizeRuntimePath = (runtime: {
  libraryPath?: string | null
  binaryPath?: string | null
}): string | null => runtime.binaryPath ?? runtime.libraryPath ?? null

const createUnsupportedSnapshot = (
  checkedAt: string,
  host: DslogicNativeHostMetadata
): DslogicNativeRuntimeSnapshot => ({
  checkedAt,
  host,
  runtime: {
    state: "unsupported-os",
    libraryPath: null,
    binaryPath: null,
    version: null
  },
  devices: [],
  diagnostics: []
})

const cloneProbeResult = (
  result: Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics">
): Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics"> => ({
  runtime: { ...result.runtime },
  devices: result.devices.map((device) => ({ ...device })),
  diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic }))
})

const combineCommandOutput = (
  result: Pick<DslogicNativeCommandResult, "stdout" | "stderr">
): string => [result.stdout, result.stderr].filter((chunk) => chunk.trim().length > 0).join("\n")

const createRuntimeDiagnostic = (
  code: InventoryDiagnosticCode,
  message: string,
  runtime: { libraryPath?: string | null; binaryPath?: string | null; version: string | null }
): DslogicNativeRuntimeDiagnostic => {
  const binaryPath = normalizeRuntimePath(runtime)

  return {
    code,
    message,
    libraryPath: binaryPath,
    binaryPath,
    backendVersion: runtime.version
  }
}

const createRuntimeResult = (
  host: DslogicNativeHostMetadata,
  state: Exclude<DslogicNativeRuntimeState, "unsupported-os">,
  runtime: { libraryPath?: string | null; binaryPath?: string | null; version: string | null },
  code?: InventoryDiagnosticCode
): Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics"> => {
  const binaryPath = normalizeRuntimePath(runtime)
  const messageByCode: Record<InventoryDiagnosticCode, string> = {
    "backend-missing-runtime": `dsview-cli runtime is not available on ${host.platform}.`,
    "backend-unsupported-os": `dsview-cli probing is not supported on ${host.platform}.`,
    "backend-runtime-failed": `dsview-cli runtime probe failed on ${host.platform}.`,
    "backend-runtime-timeout": `dsview-cli runtime probe timed out before readiness was confirmed on ${host.platform}.`,
    "backend-runtime-malformed-response": `dsview-cli runtime probe returned malformed output on ${host.platform}.`,
    "device-unsupported-variant": `Unsupported DSLogic variant detected on ${host.platform}.`,
    "device-runtime-malformed-response": `Unable to classify DSLogic variant on ${host.platform}.`
  }

  return {
    runtime: {
      state,
      libraryPath: binaryPath,
      binaryPath,
      version: runtime.version
    },
    devices: [],
    diagnostics: code
      ? [createRuntimeDiagnostic(code, messageByCode[code], { ...runtime, binaryPath })]
      : []
  }
}

const defaultExecuteCommand: DslogicNativeCommandRunner = (
  command,
  args,
  options
) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, stdout, stderr })
          return
        }

        if (typeof error === "object" && error !== null) {
          const nativeCode = "code" in error ? (error.code as string | number | null | undefined) : null
          const signal = "signal" in error ? (error.signal as NodeJS.Signals | null | undefined) : null
          const exitCode = typeof nativeCode === "number" ? nativeCode : null
          const killed = "killed" in error ? Boolean(error.killed) : false
          const reason =
            nativeCode === "ENOENT"
              ? "missing"
              : killed && /timed out/i.test(error.message)
                ? "timeout"
                : "failed"

          resolve({
            ok: false,
            reason,
            stdout: typeof stdout === "string" ? stdout : "",
            stderr: typeof stderr === "string" ? stderr : "",
            exitCode,
            signal: signal ?? null,
            nativeCode: nativeCode ?? null
          })
          return
        }

        reject(error)
      }
    )
  })

const looksLikeFileSystemPath = (value: string): boolean => {
  const trimmed = value.trim()
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("~") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  )
}

const parseDsviewVersionOutput = (
  output: string,
  commandPath?: string
): ParsedDsviewVersion | null => {
  const versionMatch =
    output.match(/\bdsview-cli\b(?:\s+version)?\s+v?([0-9][^\s]*)/i) ??
    output.match(/\bdsview\s+cli\b(?:\s+version)?\s+v?([0-9][^\s]*)/i)

  if (!versionMatch?.[1]) {
    return null
  }

  const unixBinaryMatch = output.match(/(?:^|\s)(\/[\w./-]*dsview-cli(?:\.exe)?)(?=$|\s)/i)
  const windowsBinaryMatch = output.match(/([A-Za-z]:\\[^\r\n]*?dsview-cli(?:\.exe)?)/i)
  const explicitPath =
    typeof commandPath === "string" && looksLikeFileSystemPath(commandPath)
      ? commandPath.trim()
      : null

  return {
    version: versionMatch[1],
    binaryPath: unixBinaryMatch?.[1] ?? windowsBinaryMatch?.[1] ?? explicitPath
  }
}

const createDefaultProbeRuntime = (options: {
  dsviewCliPath: string
  probeTimeoutMs: number
  executeCommand: DslogicNativeCommandRunner
}): NonNullable<CreateDslogicNativeRuntimeOptions["probeRuntime"]> =>
  async (host) => {
    const versionResult = await options.executeCommand(
      options.dsviewCliPath,
      ["--version"],
      {
        timeoutMs: options.probeTimeoutMs,
        maxBufferBytes: DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES
      }
    )

    if (!versionResult.ok) {
      switch (versionResult.reason) {
        case "missing":
          return createRuntimeResult(
            host,
            "missing",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-missing-runtime"
          )
        case "timeout":
          return createRuntimeResult(
            host,
            "timeout",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-runtime-timeout"
          )
        default:
          return createRuntimeResult(
            host,
            "failed",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-runtime-failed"
          )
      }
    }

    const parsedVersion = parseDsviewVersionOutput(
      combineCommandOutput(versionResult),
      options.dsviewCliPath
    )
    if (!parsedVersion) {
      return createRuntimeResult(
        host,
        "malformed",
        { libraryPath: null, binaryPath: null, version: null },
        "backend-runtime-malformed-response"
      )
    }

    return {
      runtime: {
        state: "ready",
        libraryPath: parsedVersion.binaryPath,
        binaryPath: parsedVersion.binaryPath,
        version: parsedVersion.version
      },
      devices: [],
      diagnostics: []
    }
  }

export const createDslogicNativeRuntime = (
  options: CreateDslogicNativeRuntimeOptions = {}
): DslogicNativeRuntime => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostOs = options.getHostOs ?? (() => process.platform)
  const getHostArch = options.getHostArch ?? (() => process.arch)
  const configuredBinaryPath = options.dsviewCliPath?.trim()
  const probeRuntime = options.probeRuntime ?? createDefaultProbeRuntime({
    dsviewCliPath:
      configuredBinaryPath && configuredBinaryPath.length > 0
        ? configuredBinaryPath
        : DEFAULT_DSVIEW_CLI_PATH,
    probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS,
    executeCommand: options.executeCommand ?? defaultExecuteCommand
  })

  return {
    async probe(): Promise<DslogicNativeRuntimeSnapshot> {
      const checkedAt = now()
      const os = getHostOs()
      const host: DslogicNativeHostMetadata = {
        platform: resolveInventoryPlatform(os),
        os,
        arch: getHostArch()
      }

      if (!SUPPORTED_HOST_OPERATING_SYSTEMS.has(os)) {
        return createUnsupportedSnapshot(checkedAt, host)
      }

      if (!DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(host.platform)) {
        return createUnsupportedSnapshot(checkedAt, host)
      }

      return {
        checkedAt,
        host,
        ...cloneProbeResult(await probeRuntime(host))
      }
    }
  }
}

export const createDslogicNativeLiveCaptureBackend = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicNativeLiveCaptureBackend => ({ capture })

export {
  createDefaultProbeRuntime,
  defaultExecuteCommand,
  parseDsviewVersionOutput
}
