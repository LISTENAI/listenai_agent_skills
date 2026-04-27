import { execFile } from "node:child_process";

const DEFAULT_DSVIEW_CLI_PATH = "dsview-cli";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export const DSVIEW_DECODER_DISCOVERY_PHASES = ["list", "inspect"] as const;
export type DsviewDecoderDiscoveryPhase =
  (typeof DSVIEW_DECODER_DISCOVERY_PHASES)[number];

export const DSVIEW_DECODER_DISCOVERY_FAILURE_REASONS = [
  "command-failed",
  "cli-error",
  "malformed-output"
] as const;
export type DsviewDecoderDiscoveryFailureReason =
  (typeof DSVIEW_DECODER_DISCOVERY_FAILURE_REASONS)[number];

export interface DsviewDecodeCommandSuccess {
  ok: true;
  stdout: string;
  stderr: string;
}

export interface DsviewDecodeCommandFailure {
  ok: false;
  reason: "missing" | "timeout" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  nativeCode: string | number | null;
}

export type DsviewDecodeCommandResult =
  | DsviewDecodeCommandSuccess
  | DsviewDecodeCommandFailure;

export type DsviewDecodeCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    timeoutMs: number;
    maxBufferBytes: number;
  }
) => Promise<DsviewDecodeCommandResult>;

export interface DsviewDecoderDiscoveryOptions {
  dsviewCliPath?: string;
  decodeRuntimePath?: string;
  decoderDir?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  executeCommand?: DsviewDecodeCommandRunner;
}

export interface DsviewDecoderIoKind {
  id: string;
}

export interface DsviewDecoderSummary {
  id: string;
  name: string | null;
  longname: string | null;
  description: string | null;
  license: string | null;
  inputs: readonly DsviewDecoderIoKind[];
  outputs: readonly DsviewDecoderIoKind[];
  tags: readonly string[];
  requiredChannelIds: readonly string[];
  optionalChannelIds: readonly string[];
  optionIds: readonly string[];
  annotationIds: readonly string[];
  annotationRowIds: readonly string[];
}

export interface DsviewDecoderChannel {
  id: string;
  name: string | null;
  description: string | null;
  order: number | null;
  channelType: number | null;
  idn: string | null;
}

export interface DsviewDecoderOption {
  id: string;
  idn: string | null;
  description: string | null;
  defaultValue: string | number | boolean | null;
  values: readonly (string | number | boolean)[];
}

export interface DsviewDecoderAnnotation {
  id: string;
  label: string | null;
  description: string | null;
  annotationType: number | null;
}

export interface DsviewDecoderAnnotationRow {
  id: string;
  description: string | null;
  annotationClasses: readonly number[];
}

export interface DsviewDecoderDetails extends DsviewDecoderSummary {
  requiredChannels: readonly DsviewDecoderChannel[];
  optionalChannels: readonly DsviewDecoderChannel[];
  options: readonly DsviewDecoderOption[];
  annotations: readonly DsviewDecoderAnnotation[];
  annotationRows: readonly DsviewDecoderAnnotationRow[];
}

export interface DsviewDecoderDiscoveryCommandContext {
  phase: DsviewDecoderDiscoveryPhase;
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  nativeCode: string | number | null;
}

export interface DsviewDecoderDiscoveryFailure {
  ok: false;
  reason: DsviewDecoderDiscoveryFailureReason;
  phase: DsviewDecoderDiscoveryPhase;
  code: string | null;
  message: string;
  detail: string | null;
  command: DsviewDecoderDiscoveryCommandContext;
}

export interface DsviewDecoderListSuccess {
  ok: true;
  phase: "list";
  decoders: readonly DsviewDecoderSummary[];
  command: DsviewDecoderDiscoveryCommandContext;
}

export interface DsviewDecoderInspectSuccess {
  ok: true;
  phase: "inspect";
  decoder: DsviewDecoderDetails;
  command: DsviewDecoderDiscoveryCommandContext;
}

export type DsviewDecoderListResult =
  | DsviewDecoderListSuccess
  | DsviewDecoderDiscoveryFailure;
export type DsviewDecoderInspectResult =
  | DsviewDecoderInspectSuccess
  | DsviewDecoderDiscoveryFailure;

const defaultExecuteCommand: DsviewDecodeCommandRunner = (
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
          resolve({ ok: true, stdout, stderr });
          return;
        }

        if (typeof error === "object" && error !== null) {
          const nativeCode = "code" in error ? (error.code as string | number | null | undefined) : null;
          const signal = "signal" in error ? (error.signal as NodeJS.Signals | null | undefined) : null;
          const exitCode = typeof nativeCode === "number" ? nativeCode : null;
          const killed = "killed" in error ? Boolean(error.killed) : false;
          const reason =
            nativeCode === "ENOENT"
              ? "missing"
              : killed && /timed out/i.test(error.message)
                ? "timeout"
                : "failed";

          resolve({
            ok: false,
            reason,
            stdout: typeof stdout === "string" ? stdout : "",
            stderr: typeof stderr === "string" ? stderr : "",
            exitCode,
            signal: signal ?? null,
            nativeCode: nativeCode ?? null
          });
          return;
        }

        reject(error);
      }
    );
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractJsonObject = (output: string): string | null => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return output.slice(start, end + 1);
};

const combineCommandOutput = (
  result: Pick<DsviewDecodeCommandResult, "stdout" | "stderr">
): string => [result.stdout, result.stderr].filter((chunk) => chunk.trim().length > 0).join("\n");

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readPrimitive = (value: unknown): string | number | boolean | null => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return null;
};

const readPrimitiveArray = (value: unknown): (string | number | boolean)[] =>
  Array.isArray(value) ? value.flatMap((entry) => {
    const primitive = readPrimitive(entry);
    return primitive === null ? [] : [primitive];
  }) : [];

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((entry) => {
    const parsed = readString(entry);
    return parsed === null ? [] : [parsed];
  }) : [];

const readNumberArray = (value: unknown): number[] =>
  Array.isArray(value) ? value.flatMap((entry) => {
    const parsed = readNumber(entry);
    return parsed === null ? [] : [parsed];
  }) : [];

const readIoKinds = (value: unknown): DsviewDecoderIoKind[] =>
  Array.isArray(value) ? value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const id = readString(entry.id);
    return id === null ? [] : [{ id }];
  }) : [];

const parseSummary = (value: unknown): DsviewDecoderSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    name: readString(value.name),
    longname: readString(value.longname),
    description: readString(value.description),
    license: readString(value.license),
    inputs: readIoKinds(value.inputs),
    outputs: readIoKinds(value.outputs),
    tags: readStringArray(value.tags),
    requiredChannelIds: readStringArray(value.required_channel_ids ?? value.requiredChannelIds),
    optionalChannelIds: readStringArray(value.optional_channel_ids ?? value.optionalChannelIds),
    optionIds: readStringArray(value.option_ids ?? value.optionIds),
    annotationIds: readStringArray(value.annotation_ids ?? value.annotationIds),
    annotationRowIds: readStringArray(value.annotation_row_ids ?? value.annotationRowIds)
  };
};

const parseChannel = (value: unknown): DsviewDecoderChannel | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    name: readString(value.name),
    description: readString(value.description),
    order: readNumber(value.order),
    channelType: readNumber(value.channel_type ?? value.channelType),
    idn: readString(value.idn)
  };
};

const parseOption = (value: unknown): DsviewDecoderOption | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    idn: readString(value.idn),
    description: readString(value.description),
    defaultValue: readPrimitive(value.default_value ?? value.defaultValue),
    values: readPrimitiveArray(value.values)
  };
};

const parseAnnotation = (value: unknown): DsviewDecoderAnnotation | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    label: readString(value.label),
    description: readString(value.description),
    annotationType: readNumber(value.annotation_type ?? value.annotationType)
  };
};

const parseAnnotationRow = (value: unknown): DsviewDecoderAnnotationRow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    description: readString(value.description),
    annotationClasses: readNumberArray(value.annotation_classes ?? value.annotationClasses)
  };
};

const compact = <T>(values: readonly (T | null)[]): T[] =>
  values.flatMap((value) => value === null ? [] : [value]);

const parseDecoderDetails = (value: unknown): DsviewDecoderDetails | null => {
  const summary = parseSummary(value);
  if (summary === null || !isRecord(value)) {
    return null;
  }

  return {
    ...summary,
    requiredChannels: compact(Array.isArray(value.required_channels) ? value.required_channels.map(parseChannel) : []),
    optionalChannels: compact(Array.isArray(value.optional_channels) ? value.optional_channels.map(parseChannel) : []),
    options: compact(Array.isArray(value.options) ? value.options.map(parseOption) : []),
    annotations: compact(Array.isArray(value.annotations) ? value.annotations.map(parseAnnotation) : []),
    annotationRows: compact(Array.isArray(value.annotation_rows) ? value.annotation_rows.map(parseAnnotationRow) : [])
  };
};

const parseOutputPayload = (output: string): { ok: true; payload: Record<string, unknown> } | { ok: false } => {
  const payloadText = extractJsonObject(output);
  if (!payloadText) {
    return { ok: false };
  }

  try {
    const payload = JSON.parse(payloadText) as unknown;
    return isRecord(payload) ? { ok: true, payload } : { ok: false };
  } catch {
    return { ok: false };
  }
};

const createCommandContext = (
  phase: DsviewDecoderDiscoveryPhase,
  command: string,
  args: readonly string[],
  result: DsviewDecodeCommandResult
): DsviewDecoderDiscoveryCommandContext => ({
  phase,
  command,
  args: [...args],
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: result.ok ? null : result.exitCode,
  signal: result.ok ? null : result.signal,
  nativeCode: result.ok ? null : result.nativeCode
});

const createFailure = (
  reason: DsviewDecoderDiscoveryFailureReason,
  phase: DsviewDecoderDiscoveryPhase,
  command: string,
  args: readonly string[],
  result: DsviewDecodeCommandResult,
  message: string,
  overrides: { code?: string | null; detail?: string | null } = {}
): DsviewDecoderDiscoveryFailure => ({
  ok: false,
  reason,
  phase,
  code: overrides.code ?? null,
  message,
  detail: overrides.detail ?? null,
  command: createCommandContext(phase, command, args, result)
});

const createCliErrorFailure = (
  phase: DsviewDecoderDiscoveryPhase,
  command: string,
  args: readonly string[],
  result: DsviewDecodeCommandResult,
  payload: Record<string, unknown>
): DsviewDecoderDiscoveryFailure => ({
  ok: false,
  reason: "cli-error",
  phase,
  code: readString(payload.code),
  message: readString(payload.message) ?? `dsview-cli decode ${phase} failed.`,
  detail: readString(payload.detail),
  command: createCommandContext(phase, command, args, result)
});

const buildDecodeArgs = (
  subcommand: "list" | "inspect",
  options: DsviewDecoderDiscoveryOptions,
  tail: readonly string[] = []
): string[] => [
  "decode",
  subcommand,
  ...(options.decodeRuntimePath?.trim()
    ? ["--decode-runtime", options.decodeRuntimePath.trim()]
    : []),
  ...(options.decoderDir?.trim()
    ? ["--decoder-dir", options.decoderDir.trim()]
    : []),
  "--format",
  "json",
  ...tail
];

const runDecodeCommand = async (
  phase: DsviewDecoderDiscoveryPhase,
  options: DsviewDecoderDiscoveryOptions,
  args: readonly string[]
): Promise<{
  command: string;
  args: readonly string[];
  result: DsviewDecodeCommandResult;
  payload: Record<string, unknown> | null;
}> => {
  const command = options.dsviewCliPath?.trim() || DEFAULT_DSVIEW_CLI_PATH;
  const executeCommand = options.executeCommand ?? defaultExecuteCommand;
  const result = await executeCommand(command, args, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBufferBytes: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
  });
  const parsed = parseOutputPayload(combineCommandOutput(result));

  return {
    command,
    args,
    result,
    payload: parsed.ok ? parsed.payload : null
  };
};

export const listDsviewDecoders = async (
  options: DsviewDecoderDiscoveryOptions = {}
): Promise<DsviewDecoderListResult> => {
  const args = buildDecodeArgs("list", options);
  const { command, result, payload } = await runDecodeCommand("list", options, args);

  if (!result.ok) {
    if (payload && (payload.code !== undefined || payload.message !== undefined)) {
      return createCliErrorFailure("list", command, args, result, payload);
    }

    return createFailure(
      "command-failed",
      "list",
      command,
      args,
      result,
      `dsview-cli decode list ${result.reason}.`
    );
  }

  if (payload && (payload.code !== undefined || payload.message !== undefined) && !Array.isArray(payload.decoders)) {
    return createCliErrorFailure("list", command, args, result, payload);
  }

  if (!payload || !Array.isArray(payload.decoders)) {
    return createFailure(
      "malformed-output",
      "list",
      command,
      args,
      result,
      "dsview-cli decode list did not return a decoder array."
    );
  }

  return {
    ok: true,
    phase: "list",
    decoders: compact(payload.decoders.map(parseSummary)),
    command: createCommandContext("list", command, args, result)
  };
};

export const inspectDsviewDecoder = async (
  decoderId: string,
  options: DsviewDecoderDiscoveryOptions = {}
): Promise<DsviewDecoderInspectResult> => {
  const normalizedDecoderId = decoderId.trim();
  const args = buildDecodeArgs("inspect", options, [normalizedDecoderId]);
  const { command, result, payload } = await runDecodeCommand("inspect", options, args);

  if (!result.ok) {
    if (payload && (payload.code !== undefined || payload.message !== undefined)) {
      return createCliErrorFailure("inspect", command, args, result, payload);
    }

    return createFailure(
      "command-failed",
      "inspect",
      command,
      args,
      result,
      `dsview-cli decode inspect ${result.reason}.`
    );
  }

  if (payload && (payload.code !== undefined || payload.message !== undefined) && payload.decoder === undefined) {
    return createCliErrorFailure("inspect", command, args, result, payload);
  }

  const decoder = payload ? parseDecoderDetails(payload.decoder) : null;
  if (!decoder) {
    return createFailure(
      "malformed-output",
      "inspect",
      command,
      args,
      result,
      `dsview-cli decode inspect did not return decoder details for ${normalizedDecoderId}.`
    );
  }

  return {
    ok: true,
    phase: "inspect",
    decoder,
    command: createCommandContext("inspect", command, args, result)
  };
};
