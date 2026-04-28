import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"

export interface ResourceManagerDaemonState {
  status: "running"
  pid: number
  host: string
  port: number
  url: string
  provider: string
  startedAt: string
  stateDir: string
  stateFile: string
  logFile: string
}

export interface ResourceManagerDaemonStatus {
  status: "running" | "stopped" | "stale"
  pid: number | null
  host: string | null
  port: number | null
  url: string | null
  provider: string | null
  health: "ok" | "failed" | "not-checked"
  stateDir: string
  stateFile: string
  logFile: string | null
  message: string
}

export interface DaemonPaths {
  stateDir: string
  stateFile: string
  logFile: string
}

export interface StartDaemonOptions {
  cliPath: string
  execArgv: readonly string[]
  host: string
  port: number
  provider: string
  args: readonly string[]
  stateDir?: string
  logFile?: string
  readyTimeoutMs?: number
}

export interface StopDaemonOptions {
  stateDir?: string
  timeoutMs?: number
}

export interface StatusDaemonOptions {
  stateDir?: string
}

const DEFAULT_READY_TIMEOUT_MS = 10_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000

export function resolveDaemonPaths(stateDir?: string, logFile?: string): DaemonPaths {
  const resolvedStateDir = resolve(
    stateDir?.trim() || process.env.RESOURCE_MANAGER_STATE_DIR?.trim() || join(homedir(), ".listenai", "resource-manager")
  )
  return {
    stateDir: resolvedStateDir,
    stateFile: join(resolvedStateDir, "resource-manager.json"),
    logFile: resolve(logFile?.trim() || process.env.RESOURCE_MANAGER_LOG_FILE?.trim() || join(resolvedStateDir, "resource-manager.log"))
  }
}

export function readDaemonState(paths: DaemonPaths): ResourceManagerDaemonState | null {
  try {
    const parsed = JSON.parse(readFileSync(paths.stateFile, "utf-8")) as ResourceManagerDaemonState
    if (
      parsed &&
      parsed.status === "running" &&
      typeof parsed.pid === "number" &&
      typeof parsed.host === "string" &&
      typeof parsed.port === "number" &&
      typeof parsed.url === "string"
    ) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

export function writeDaemonState(state: ResourceManagerDaemonState): void {
  mkdirSync(dirname(state.stateFile), { recursive: true })
  writeFileSync(state.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
}

export function clearDaemonState(paths: DaemonPaths): void {
  rmSync(paths.stateFile, { force: true })
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`)
    if (!response.ok) return false
    const body = await response.json() as { status?: unknown }
    return body.status === "ok"
  } catch {
    return false
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  let lastError = "health endpoint did not return ok"

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkHealth(url)) return
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 100))
    lastError = `timed out waiting for ${url}/health`
  }

  throw new Error(lastError)
}

export async function getDaemonStatus(options: StatusDaemonOptions = {}): Promise<ResourceManagerDaemonStatus> {
  const paths = resolveDaemonPaths(options.stateDir)
  const state = readDaemonState(paths)
  if (!state) {
    return {
      status: "stopped",
      pid: null,
      host: null,
      port: null,
      url: null,
      provider: null,
      health: "not-checked",
      stateDir: paths.stateDir,
      stateFile: paths.stateFile,
      logFile: paths.logFile,
      message: "resource-manager daemon is not running"
    }
  }

  if (!isProcessAlive(state.pid)) {
    return {
      status: "stale",
      pid: state.pid,
      host: state.host,
      port: state.port,
      url: state.url,
      provider: state.provider,
      health: "failed",
      stateDir: paths.stateDir,
      stateFile: paths.stateFile,
      logFile: state.logFile,
      message: "resource-manager daemon state is stale; process is not running"
    }
  }

  const healthy = await checkHealth(state.url)
  return {
    status: healthy ? "running" : "stale",
    pid: state.pid,
    host: state.host,
    port: state.port,
    url: state.url,
    provider: state.provider,
    health: healthy ? "ok" : "failed",
    stateDir: paths.stateDir,
    stateFile: paths.stateFile,
    logFile: state.logFile,
    message: healthy
      ? "resource-manager daemon is running"
      : "resource-manager daemon process is alive but health check failed"
  }
}

export async function startDaemon(options: StartDaemonOptions): Promise<ResourceManagerDaemonStatus> {
  if (options.port === 0) {
    throw new Error("Daemon mode requires an explicit non-zero port")
  }

  const paths = resolveDaemonPaths(options.stateDir, options.logFile)
  const existing = await getDaemonStatus({ stateDir: paths.stateDir })
  if (existing.status === "running") {
    return existing
  }

  if (existing.status === "stale") {
    clearDaemonState(paths)
  }

  mkdirSync(paths.stateDir, { recursive: true })
  mkdirSync(dirname(paths.logFile), { recursive: true })
  const logFd = openSync(paths.logFile, "a")
  const child = spawn(process.execPath, [...options.execArgv, options.cliPath, "start", "--daemon-child", ...options.args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      RESOURCE_MANAGER_STATE_DIR: paths.stateDir,
      RESOURCE_MANAGER_LOG_FILE: paths.logFile
    }
  })

  child.unref()

  const url = `http://${options.host}:${options.port}`
  const state: ResourceManagerDaemonState = {
    status: "running",
    pid: child.pid ?? -1,
    host: options.host,
    port: options.port,
    url,
    provider: options.provider,
    startedAt: new Date().toISOString(),
    stateDir: paths.stateDir,
    stateFile: paths.stateFile,
    logFile: paths.logFile
  }

  writeDaemonState(state)

  try {
    await waitForHealth(url, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
  } catch (error) {
    if (child.pid && isProcessAlive(child.pid)) {
      try {
        process.kill(child.pid, "SIGTERM")
      } catch {
        // Best-effort cleanup only.
      }
    }
    clearDaemonState(paths)
    throw error
  }

  return getDaemonStatus({ stateDir: paths.stateDir })
}

export async function stopDaemon(options: StopDaemonOptions = {}): Promise<ResourceManagerDaemonStatus> {
  const paths = resolveDaemonPaths(options.stateDir)
  const state = readDaemonState(paths)
  if (!state) {
    return getDaemonStatus({ stateDir: paths.stateDir })
  }

  if (!isProcessAlive(state.pid)) {
    clearDaemonState(paths)
    return getDaemonStatus({ stateDir: paths.stateDir })
  }

  try {
    process.kill(state.pid, "SIGTERM")
  } catch {
    clearDaemonState(paths)
    return getDaemonStatus({ stateDir: paths.stateDir })
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(state.pid)) {
      clearDaemonState(paths)
      return getDaemonStatus({ stateDir: paths.stateDir })
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 100))
  }

  throw new Error(`Timed out stopping resource-manager daemon pid ${state.pid}`)
}
