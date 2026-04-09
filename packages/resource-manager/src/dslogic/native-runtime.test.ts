import { describe, expect, it } from "vitest"
import {
  createDslogicNativeRuntime,
  type DslogicNativeCommandResult,
  type DslogicNativeCommandRunner
} from "./native-runtime.js"

const checkedAt = "2026-04-02T04:00:00.000Z"

const createCommandRunner = (results: readonly DslogicNativeCommandResult[]) => {
  const queue = [...results]
  const calls: Array<{
    command: string
    args: readonly string[]
    timeoutMs: number
    maxBufferBytes: number
  }> = []

  const runner: DslogicNativeCommandRunner = async (command, args, options) => {
    calls.push({
      command,
      args: [...args],
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes
    })

    const next = queue.shift()
    if (!next) {
      throw new Error(`No queued command result for ${command} ${args.join(" ")}`)
    }

    return next
  }

  return { runner, calls }
}

describe("native-runtime", () => {
  it("returns unsupported-os for hosts outside the modeled platform list", async () => {
    const { runner, calls } = createCommandRunner([])
    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "freebsd",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "linux",
        os: "freebsd",
        arch: "arm64"
      },
      runtime: {
        state: "unsupported-os",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([])
  })

  it("probes linux hosts through dsview-cli instead of short-circuiting to missing", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "dsview-cli 1.0.3\n",
        stderr: ""
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "linux",
      getHostArch: () => "x64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "linux",
        os: "linux",
        arch: "x64"
      },
      runtime: {
        state: "ready",
        libraryPath: null,
        binaryPath: null,
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "dsview-cli",
        args: ["--version"],
        timeoutMs: 3_000,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("prefers an explicitly configured dsview-cli bundle path over PATH fallback", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "dsview-cli 1.0.3\n",
        stderr: "bundle path=/Applications/DSView.app/Contents/MacOS/dsview-cli\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner,
      dsviewCliPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
      probeTimeoutMs: 1234
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      runtime: {
        state: "ready",
        libraryPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        binaryPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        args: ["--version"],
        timeoutMs: 1234,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("keeps PATH fallback explicit when no bundle path is configured", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "DSView CLI v1.0.3\n",
        stderr: "resolved executable /opt/dsview/bin/dsview-cli\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "ready",
        libraryPath: "/opt/dsview/bin/dsview-cli",
        binaryPath: "/opt/dsview/bin/dsview-cli",
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "dsview-cli",
        args: ["--version"],
        timeoutMs: 3_000,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("maps a missing configured dsview-cli bundle into the missing-runtime diagnostic", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: false,
        reason: "missing",
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        nativeCode: "ENOENT"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner,
      dsviewCliPath: "/opt/dsview/bin/dsview-cli"
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      runtime: {
        state: "missing",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      devices: [],
      diagnostics: [
        {
          code: "backend-missing-runtime",
          message: "dsview-cli runtime is not available on macos.",
          libraryPath: null,
          binaryPath: null,
          backendVersion: null
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })

  it("maps dsview-cli probe timeouts into the timeout state", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "timeout",
        stdout: "dsview-cli 1.0.3\n",
        stderr: "",
        exitCode: null,
        signal: "SIGTERM",
        nativeCode: null
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "timeout",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          message: "dsview-cli runtime probe timed out before readiness was confirmed on macos."
        }
      ]
    })
  })

  it("maps non-zero dsview-cli failures into the failed state", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "failed",
        stdout: "",
        stderr: "bundle bootstrap failed",
        exitCode: 2,
        signal: null,
        nativeCode: 2
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "failed",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-failed",
          message: "dsview-cli runtime probe failed on macos.",
          libraryPath: null,
          binaryPath: null,
          backendVersion: null
        }
      ]
    })
  })

  it("rejects malformed dsview-cli version output without inventing readiness", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "bundle ready\n",
        stderr: "version unknown\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "malformed",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-malformed-response",
          message: "dsview-cli runtime probe returned malformed output on macos."
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })
})
