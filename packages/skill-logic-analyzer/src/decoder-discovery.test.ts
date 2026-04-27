import { describe, expect, it } from "vitest";
import {
  inspectDsviewDecoder,
  listDsviewDecoders,
  type DsviewDecodeCommandResult,
  type DsviewDecodeCommandRunner
} from "./decoder-discovery.js";

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

describe("decoder discovery", () => {
  it("lists decoder summaries from noisy dsview-cli JSON output", async () => {
    const payload = {
      decoders: [
        {
          id: "1:i2c",
          name: "1:I2C",
          longname: "Inter-Integrated Circuit",
          description: "Two-wire serial bus.",
          license: "gplv2+",
          inputs: [{ id: "logic" }],
          outputs: [{ id: "i2c" }],
          tags: ["Embedded/industrial"],
          required_channel_ids: ["scl", "sda"],
          optional_channel_ids: [],
          option_ids: ["address_format"],
          annotation_ids: ["start", "stop"],
          annotation_row_ids: ["bits", "addr-data"]
        },
        {
          id: "0:spi",
          name: "0:SPI",
          longname: "Serial Peripheral Interface",
          description: "Synchronous serial bus.",
          license: "gplv2+",
          inputs: [{ id: "logic" }],
          outputs: [{ id: "spi" }],
          tags: [],
          required_channel_ids: ["clk", "miso", "mosi", "cs"],
          optional_channel_ids: [],
          option_ids: [],
          annotation_ids: [],
          annotation_row_ids: []
        }
      ]
    };
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: `sr: init\n${JSON.stringify(payload, null, 2)}\nsr: done\n`,
        stderr: ""
      }
    ]);

    const result = await listDsviewDecoders({
      dsviewCliPath: "/opt/dsview/dsview-cli",
      decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
      decoderDir: "/opt/dsview/decoders",
      timeoutMs: 1234,
      maxBufferBytes: 4096,
      executeCommand: runner
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "list",
      decoders: [
        {
          id: "1:i2c",
          requiredChannelIds: ["scl", "sda"],
          optionIds: ["address_format"]
        },
        {
          id: "0:spi",
          requiredChannelIds: ["clk", "miso", "mosi", "cs"]
        }
      ]
    });
    expect(calls).toEqual([
      {
        command: "/opt/dsview/dsview-cli",
        args: [
          "decode",
          "list",
          "--decode-runtime",
          "/opt/dsview/lib/libdsview_decode_runtime.so",
          "--decoder-dir",
          "/opt/dsview/decoders",
          "--format",
          "json"
        ],
        timeoutMs: 1234,
        maxBufferBytes: 4096
      }
    ]);
  });

  it("inspects decoder channels, options, annotations, and rows", async () => {
    const payload = {
      decoder: {
        id: "1:i2c",
        name: "1:I2C",
        longname: "Inter-Integrated Circuit",
        description: "Two-wire serial bus.",
        license: "gplv2+",
        inputs: [{ id: "logic" }],
        outputs: [{ id: "i2c" }],
        tags: ["Embedded/industrial"],
        required_channels: [
          {
            id: "scl",
            name: "SCL",
            description: "Serial clock line",
            order: 0,
            channel_type: 8,
            idn: "dec_1i2c_chan_scl"
          },
          {
            id: "sda",
            name: "SDA",
            description: "Serial data line",
            order: 1,
            channel_type: 108,
            idn: "dec_1i2c_chan_sda"
          }
        ],
        optional_channels: [],
        options: [
          {
            id: "address_format",
            idn: "dec_1i2c_opt_addr",
            description: "Displayed slave address format",
            default_value: "'unshifted'",
            values: ["'shifted'", "'unshifted'"]
          }
        ],
        annotations: [
          {
            id: "7",
            label: "start",
            description: "Start condition",
            annotation_type: 1000
          }
        ],
        annotation_rows: [
          {
            id: "bits",
            description: "Bits",
            annotation_classes: [5]
          }
        ]
      }
    };
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: JSON.stringify(payload),
        stderr: ""
      }
    ]);

    const result = await inspectDsviewDecoder(" 1:i2c ", {
      executeCommand: runner
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "inspect",
      decoder: {
        id: "1:i2c",
        requiredChannels: [
          {
            id: "scl",
            order: 0,
            channelType: 8,
            idn: "dec_1i2c_chan_scl"
          },
          {
            id: "sda",
            order: 1,
            channelType: 108,
            idn: "dec_1i2c_chan_sda"
          }
        ],
        options: [
          {
            id: "address_format",
            defaultValue: "'unshifted'",
            values: ["'shifted'", "'unshifted'"]
          }
        ],
        annotations: [{ id: "7", label: "start", annotationType: 1000 }],
        annotationRows: [{ id: "bits", annotationClasses: [5] }]
      }
    });
    expect(calls[0]?.args).toEqual([
      "decode",
      "inspect",
      "--format",
      "json",
      "1:i2c"
    ]);
  });

  it("maps dsview-cli JSON errors to structured discovery failures", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "failed",
        stdout: JSON.stringify({
          code: "decode_runtime_missing",
          message: "decoder runtime could not be loaded",
          detail: "Pass --decode-runtime or install bundled runtime."
        }),
        stderr: "",
        exitCode: 1,
        signal: null,
        nativeCode: 1
      }
    ]);

    const result = await listDsviewDecoders({ executeCommand: runner });

    expect(result).toEqual({
      ok: false,
      reason: "cli-error",
      phase: "list",
      code: "decode_runtime_missing",
      message: "decoder runtime could not be loaded",
      detail: "Pass --decode-runtime or install bundled runtime.",
      command: {
        phase: "list",
        command: "dsview-cli",
        args: ["decode", "list", "--format", "json"],
        stdout: JSON.stringify({
          code: "decode_runtime_missing",
          message: "decoder runtime could not be loaded",
          detail: "Pass --decode-runtime or install bundled runtime."
        }),
        stderr: "",
        exitCode: 1,
        signal: null,
        nativeCode: 1
      }
    });
  });

  it("returns malformed-output when inspect JSON lacks decoder details", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: JSON.stringify({ decoder: { name: "missing id" } }),
        stderr: ""
      }
    ]);

    const result = await inspectDsviewDecoder("1:i2c", { executeCommand: runner });

    expect(result).toMatchObject({
      ok: false,
      reason: "malformed-output",
      phase: "inspect",
      code: null,
      message: "dsview-cli decode inspect did not return decoder details for 1:i2c."
    });
  });

  it("returns command-failed when no JSON diagnostic is available", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "missing",
        stdout: "",
        stderr: "spawn dsview-cli ENOENT",
        exitCode: null,
        signal: null,
        nativeCode: "ENOENT"
      }
    ]);

    const result = await listDsviewDecoders({ executeCommand: runner });

    expect(result).toMatchObject({
      ok: false,
      reason: "command-failed",
      phase: "list",
      message: "dsview-cli decode list missing.",
      command: {
        nativeCode: "ENOENT",
        stderr: "spawn dsview-cli ENOENT"
      }
    });
  });
});
