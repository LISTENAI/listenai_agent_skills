import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DsviewDecodeCommandResult,
  DsviewDecodeCommandRunner,
  DsviewDecoderDetails
} from "./decoder-discovery.js";
import { runDsviewDecoder } from "./decoder-runner.js";

const i2cDecoder: DsviewDecoderDetails = {
  id: "1:i2c",
  name: "1:I2C",
  longname: "Inter-Integrated Circuit",
  description: "Two-wire serial bus.",
  license: "gplv2+",
  inputs: [{ id: "logic" }],
  outputs: [{ id: "i2c" }],
  tags: ["Embedded/industrial"],
  requiredChannelIds: ["scl", "sda"],
  optionalChannelIds: ["reset"],
  optionIds: ["address_format"],
  annotationIds: ["start", "stop"],
  annotationRowIds: ["bits"],
  requiredChannels: [
    {
      id: "scl",
      name: "SCL",
      description: "Serial clock line",
      order: 0,
      channelType: 8,
      idn: "dec_1i2c_chan_scl"
    },
    {
      id: "sda",
      name: "SDA",
      description: "Serial data line",
      order: 1,
      channelType: 108,
      idn: "dec_1i2c_chan_sda"
    }
  ],
  optionalChannels: [
    {
      id: "reset",
      name: "RESET",
      description: "Optional reset line",
      order: 2,
      channelType: null,
      idn: null
    }
  ],
  options: [
    {
      id: "address_format",
      idn: "dec_1i2c_opt_addr",
      description: "Displayed slave address format",
      defaultValue: "'unshifted'",
      values: ["'shifted'", "'unshifted'"]
    }
  ],
  annotations: [
    {
      id: "start",
      label: "start",
      description: "Start condition",
      annotationType: 1000
    }
  ],
  annotationRows: [
    {
      id: "bits",
      description: "Bits",
      annotationClasses: [5]
    }
  ]
};

const createCommandRunner = (results: readonly DsviewDecodeCommandResult[]) => {
  const queue = [...results];
  const calls: Array<{
    command: string;
    args: readonly string[];
    timeoutMs: number;
    maxBufferBytes: number;
  }> = [];

  const runner: DsviewDecodeCommandRunner = async (command, args, options) => {
    calls.push({
      command,
      args: [...args],
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes
    });

    const next = queue.shift();
    if (!next) {
      throw new Error(`No queued command result for ${command} ${args.join(" ")}`);
    }

    return next;
  };

  return { runner, calls };
};

const getInputPath = (args: readonly string[]) => {
  const inputFlagIndex = args.indexOf("--input");
  expect(inputFlagIndex).toBeGreaterThanOrEqual(0);
  const inputPath = args[inputFlagIndex + 1];
  expect(inputPath).toBeTruthy();
  return inputPath as string;
};

const expectRemoved = async (path: string) => {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
};

describe("decoder runner", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  const makeTempDir = async () => {
    const path = await mkdtemp(join(tmpdir(), "decoder-runner-test-"));
    tempDirs.push(path);
    return path;
  };

  it("runs dsview-cli decode with staged artifact, inspected metadata, and normalized report", async () => {
    const tempDir = await makeTempDir();
    const payload = {
      report: {
        annotations: [
          {
            row: "bits",
            start_sample: 0,
            end_sample: 12,
            text: ["START"]
          }
        ],
        rows: [{ id: "bits", label: "Bits" }]
      }
    };
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: `dsview noise\n${JSON.stringify(payload)}\n`,
        stderr: ""
      }
    ]);

    const result = await runDsviewDecoder(
      {
        decoderId: " 1:i2c ",
        decoder: i2cDecoder,
        artifact: {
          sourceName: "fixture.sr",
          formatHint: "sr",
          mediaType: "application/vnd.sigrok.session",
          text: "sample fixture"
        },
        channelMappings: {
          scl: "D0",
          sda: "D1",
          reset: "D2"
        },
        decoderOptions: {
          address_format: "'unshifted'"
        }
      },
      {
        dsviewCliPath: "/opt/dsview/dsview-cli",
        decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
        decoderDir: "/opt/dsview/decoders",
        timeoutMs: 1234,
        maxBufferBytes: 4096,
        tempDir,
        executeCommand: runner
      }
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "decode-run",
      decoderId: "1:i2c",
      artifact: {
        sourceName: "fixture.sr",
        formatHint: "sr",
        mediaType: "application/vnd.sigrok.session",
        hasText: true
      },
      report: {
        decoderId: "1:i2c",
        annotations: [
          {
            row: "bits",
            start_sample: 0,
            end_sample: 12,
            text: ["START"]
          }
        ],
        rows: [{ id: "bits", label: "Bits" }],
        raw: payload
      },
      cleanup: {
        attempted: true,
        ok: true
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "/opt/dsview/dsview-cli",
      timeoutMs: 1234,
      maxBufferBytes: 4096
    });
    expect(calls[0]?.args).toEqual([
      "decode",
      "run",
      "--decode-runtime",
      "/opt/dsview/lib/libdsview_decode_runtime.so",
      "--decoder-dir",
      "/opt/dsview/decoders",
      "--format",
      "json",
      "--decoder",
      "1:i2c",
      "--input",
      getInputPath(calls[0]?.args ?? []),
      "--channel",
      "scl=D0",
      "--channel",
      "sda=D1",
      "--channel",
      "reset=D2",
      "--option",
      "address_format='unshifted'"
    ]);
    await expectRemoved(getInputPath(calls[0]?.args ?? []));
  });

  it("returns validation failures without invoking dsview-cli", async () => {
    const { runner, calls } = createCommandRunner([]);

    const result = await runDsviewDecoder(
      {
        decoderId: " ",
        decoder: i2cDecoder,
        artifact: {
          text: ""
        },
        channelMappings: {
          scl: "D0",
          typo: "D7"
        },
        decoderOptions: {
          address_format: "hex",
          sample_point: 50
        }
      },
      { executeCommand: runner }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-validation",
      reason: "validation-failed",
      code: "decode-validation-failed",
      command: null,
      cleanup: {
        attempted: false,
        ok: false
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "decoderId", code: "required" }),
          expect.objectContaining({ path: "artifact", code: "required" }),
          expect.objectContaining({ path: "channelMappings.sda", code: "missing-channel" }),
          expect.objectContaining({ path: "channelMappings.typo", code: "unknown-channel" }),
          expect.objectContaining({ path: "decoderOptions.address_format", code: "invalid-value" }),
          expect.objectContaining({ path: "decoderOptions.sample_point", code: "unknown-option" })
        ])
      );
    }
    expect(calls).toEqual([]);
  });

  it("preserves dsview-cli JSON error documents before generic command failures", async () => {
    const tempDir = await makeTempDir();
    const cliError = {
      code: "decoder_runtime_missing",
      message: "decoder runtime could not be loaded",
      detail: "Pass --decode-runtime or install bundled runtime."
    };
    const { runner, calls } = createCommandRunner([
      {
        ok: false,
        reason: "failed",
        stdout: JSON.stringify(cliError),
        stderr: "native stderr",
        exitCode: 2,
        signal: null,
        nativeCode: 2
      }
    ]);

    const result = await runDsviewDecoder(
      {
        decoderId: "1:i2c",
        decoder: i2cDecoder,
        artifact: {
          bytes: new TextEncoder().encode("sample fixture")
        },
        channelMappings: {
          scl: "D0",
          sda: "D1"
        }
      },
      { tempDir, executeCommand: runner }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-run",
      reason: "cli-error",
      code: "decoder_runtime_missing",
      message: "decoder runtime could not be loaded",
      detail: "Pass --decode-runtime or install bundled runtime.",
      command: {
        stdout: JSON.stringify(cliError),
        stderr: "native stderr",
        exitCode: 2,
        signal: null,
        nativeCode: 2
      },
      cleanup: {
        attempted: true,
        ok: true
      }
    });
    await expectRemoved(getInputPath(calls[0]?.args ?? []));
  });

  it("returns malformed-output for non-report JSON while retaining command context", async () => {
    const tempDir = await makeTempDir();
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: JSON.stringify({ decoder: "1:i2c" }),
        stderr: ""
      }
    ]);

    const result = await runDsviewDecoder(
      {
        decoderId: "1:i2c",
        decoder: i2cDecoder,
        artifact: {
          text: "sample fixture"
        },
        channelMappings: {
          scl: "D0",
          sda: "D1"
        }
      },
      { tempDir, executeCommand: runner }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-run",
      reason: "malformed-output",
      message: "dsview-cli decode run did not return a decode report for 1:i2c.",
      command: {
        stdout: JSON.stringify({ decoder: "1:i2c" }),
        exitCode: null,
        nativeCode: null
      }
    });
    await expectRemoved(getInputPath(calls[0]?.args ?? []));
  });

  it("retains command diagnostics when no JSON diagnostic is available", async () => {
    const tempDir = await makeTempDir();
    const { runner, calls } = createCommandRunner([
      {
        ok: false,
        reason: "timeout",
        stdout: "",
        stderr: "decode timed out",
        exitCode: null,
        signal: "SIGTERM",
        nativeCode: null
      }
    ]);

    const result = await runDsviewDecoder(
      {
        decoderId: "1:i2c",
        decoder: i2cDecoder,
        artifact: {
          text: "sample fixture"
        },
        channelMappings: {
          scl: "D0",
          sda: "D1"
        }
      },
      { tempDir, executeCommand: runner }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-run",
      reason: "command-failed",
      code: null,
      message: "dsview-cli decode run timeout.",
      command: {
        stderr: "decode timed out",
        exitCode: null,
        signal: "SIGTERM",
        nativeCode: null
      },
      artifact: {
        hasText: true
      },
      cleanup: {
        attempted: true,
        ok: true
      }
    });
    await expectRemoved(getInputPath(calls[0]?.args ?? []));
  });
});
