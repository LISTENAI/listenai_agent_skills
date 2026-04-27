import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DsviewDecodeCommandResult,
  DsviewDecodeCommandRunner,
  DsviewDecoderDetails
} from "./decoder-discovery.js";
import type { CaptureArtifactInput, CaptureArtifactSummary } from "./capture-contracts.js";
import { summarizeCaptureArtifact } from "./capture-contracts.js";

const DEFAULT_DSVIEW_CLI_PATH = "dsview-cli";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export const DSVIEW_DECODER_RUN_PHASES = [
  "decode-validation",
  "decode-run"
] as const;
export type DsviewDecoderRunPhase = (typeof DSVIEW_DECODER_RUN_PHASES)[number];

export const DSVIEW_DECODER_RUN_FAILURE_REASONS = [
  "validation-failed",
  "command-failed",
  "cli-error",
  "malformed-output"
] as const;
export type DsviewDecoderRunFailureReason =
  (typeof DSVIEW_DECODER_RUN_FAILURE_REASONS)[number];

export const DSVIEW_DECODER_VALIDATION_ISSUE_CODES = [
  "required",
  "invalid-type",
  "invalid-value",
  "missing-channel",
  "unknown-channel",
  "unknown-option"
] as const;
export type DsviewDecoderValidationIssueCode =
  (typeof DSVIEW_DECODER_VALIDATION_ISSUE_CODES)[number];

export type DsviewDecoderOptionValue = string | number | boolean;

export interface DsviewDecoderRunRequest {
  decoderId: string;
  decoder: DsviewDecoderDetails;
  artifact: CaptureArtifactInput;
  channelMappings: Readonly<Record<string, string>>;
  decoderOptions?: Readonly<Record<string, DsviewDecoderOptionValue>>;
}

export interface DsviewDecoderRunOptions {
  dsviewCliPath?: string;
  decodeRuntimePath?: string;
  decoderDir?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  tempDir?: string;
  executeCommand: DsviewDecodeCommandRunner;
}

export interface DsviewDecoderValidationIssue {
  path: string;
  code: DsviewDecoderValidationIssueCode;
  message: string;
  expected?: string | number | boolean | readonly (string | number | boolean)[];
  actual?: string | number | boolean | null;
}

export interface DsviewDecoderRunCommandContext {
  phase: "decode-run";
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  nativeCode: string | number | null;
}

export interface DsviewDecoderTempCleanup {
  attempted: boolean;
  ok: boolean;
  path: string | null;
  message: string | null;
}

export interface DsviewDecoderReport {
  decoderId: string;
  annotations: readonly Record<string, unknown>[];
  rows: readonly Record<string, unknown>[];
  raw: Record<string, unknown>;
}

export interface DsviewDecoderRunSuccess {
  ok: true;
  phase: "decode-run";
  decoderId: string;
  report: DsviewDecoderReport;
  artifact: CaptureArtifactSummary;
  command: DsviewDecoderRunCommandContext;
  cleanup: DsviewDecoderTempCleanup;
}

export interface DsviewDecoderRunFailure {
  ok: false;
  phase: DsviewDecoderRunPhase;
  reason: DsviewDecoderRunFailureReason;
  code: string | null;
  message: string;
  detail: string | null;
  decoderId: string | null;
  artifact: CaptureArtifactSummary;
  issues: readonly DsviewDecoderValidationIssue[];
  command: DsviewDecoderRunCommandContext | null;
  cleanup: DsviewDecoderTempCleanup;
}

export type DsviewDecoderRunResult =
  | DsviewDecoderRunSuccess
  | DsviewDecoderRunFailure;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const extractJsonObject = (output: string): string | null => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return output.slice(start, end + 1);
};

const parseOutputPayload = (
  output: string
): { ok: true; payload: Record<string, unknown> } | { ok: false } => {
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

const combineCommandOutput = (
  result: Pick<DsviewDecodeCommandResult, "stdout" | "stderr">
): string =>
  [result.stdout, result.stderr]
    .filter((chunk) => chunk.trim().length > 0)
    .join("\n");

const createCommandContext = (
  command: string,
  args: readonly string[],
  result: DsviewDecodeCommandResult
): DsviewDecoderRunCommandContext => ({
  phase: "decode-run",
  command,
  args: [...args],
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: result.ok ? null : result.exitCode,
  signal: result.ok ? null : result.signal,
  nativeCode: result.ok ? null : result.nativeCode
});

const createCleanup = (
  attempted: boolean,
  path: string | null,
  error: unknown = null
): DsviewDecoderTempCleanup => ({
  attempted,
  ok: attempted && error === null,
  path,
  message: error instanceof Error ? error.message : error === null ? null : String(error)
});

const createValidationFailure = (
  decoderId: string | null,
  artifact: CaptureArtifactSummary,
  issues: readonly DsviewDecoderValidationIssue[]
): DsviewDecoderRunFailure => ({
  ok: false,
  phase: "decode-validation",
  reason: "validation-failed",
  code: "decode-validation-failed",
  message: "Decode request failed validation.",
  detail: null,
  decoderId,
  artifact,
  issues,
  command: null,
  cleanup: createCleanup(false, null)
});

const createRunFailure = (
  reason: Exclude<DsviewDecoderRunFailureReason, "validation-failed">,
  decoderId: string,
  artifact: CaptureArtifactSummary,
  command: DsviewDecoderRunCommandContext,
  cleanup: DsviewDecoderTempCleanup,
  message: string,
  overrides: { code?: string | null; detail?: string | null } = {}
): DsviewDecoderRunFailure => ({
  ok: false,
  phase: "decode-run",
  reason,
  code: overrides.code ?? null,
  message,
  detail: overrides.detail ?? null,
  decoderId,
  artifact,
  issues: [],
  command,
  cleanup
});

const buildRunArgs = (
  request: ValidatedDecodeRequest,
  inputPath: string,
  options: DsviewDecoderRunOptions
): string[] => [
  "decode",
  "run",
  ...(options.decodeRuntimePath?.trim()
    ? ["--decode-runtime", options.decodeRuntimePath.trim()]
    : []),
  ...(options.decoderDir?.trim()
    ? ["--decoder-dir", options.decoderDir.trim()]
    : []),
  "--format",
  "json",
  "--decoder",
  request.decoderId,
  "--input",
  inputPath,
  ...Object.entries(request.channelMappings).flatMap(([channelId, signalId]) => [
    "--channel",
    `${channelId}=${signalId}`
  ]),
  ...Object.entries(request.decoderOptions).flatMap(([optionId, value]) => [
    "--option",
    `${optionId}=${String(value)}`
  ])
];

type ValidatedDecodeRequest = {
  decoderId: string;
  artifact: CaptureArtifactInput;
  channelMappings: Record<string, string>;
  decoderOptions: Record<string, DsviewDecoderOptionValue>;
};

const hasArtifactPayload = (artifact: CaptureArtifactInput): boolean => {
  if (typeof artifact.text === "string") {
    return artifact.text.length > 0;
  }

  return artifact.bytes instanceof Uint8Array && artifact.bytes.byteLength > 0;
};

const validateDecodeRequest = (
  request: DsviewDecoderRunRequest
): { ok: true; request: ValidatedDecodeRequest } | { ok: false; decoderId: string | null; issues: DsviewDecoderValidationIssue[] } => {
  const issues: DsviewDecoderValidationIssue[] = [];
  const decoderId = typeof request.decoderId === "string" ? request.decoderId.trim() : "";
  const channelMappings = request.channelMappings ?? {};
  const decoderOptions = request.decoderOptions ?? {};

  if (decoderId.length === 0) {
    issues.push({
      path: "decoderId",
      code: "required",
      message: "decoderId must be a non-empty decoder id."
    });
  }

  if (!hasArtifactPayload(request.artifact)) {
    issues.push({
      path: "artifact",
      code: "required",
      message: "artifact must include non-empty text or bytes."
    });
  }

  const knownChannelIds = new Set([
    ...request.decoder.requiredChannels.map((channel) => channel.id),
    ...request.decoder.optionalChannels.map((channel) => channel.id)
  ]);
  const mappedChannelIds = Object.keys(channelMappings);

  for (const requiredChannel of request.decoder.requiredChannels) {
    const mappedValue = channelMappings[requiredChannel.id];
    if (typeof mappedValue !== "string" || mappedValue.trim().length === 0) {
      issues.push({
        path: `channelMappings.${requiredChannel.id}`,
        code: "missing-channel",
        message: `Required decoder channel ${requiredChannel.id} must be mapped.`
      });
    }
  }

  for (const channelId of mappedChannelIds) {
    const mappedValue = channelMappings[channelId];
    if (!knownChannelIds.has(channelId)) {
      issues.push({
        path: `channelMappings.${channelId}`,
        code: "unknown-channel",
        message: `Decoder channel ${channelId} is not exposed by ${request.decoder.id}.`,
        actual: channelId
      });
      continue;
    }

    if (typeof mappedValue !== "string" || mappedValue.trim().length === 0) {
      issues.push({
        path: `channelMappings.${channelId}`,
        code: "invalid-value",
        message: `Decoder channel ${channelId} must map to a non-empty artifact signal id.`,
        actual: typeof mappedValue === "string" ? mappedValue : null
      });
    }
  }

  const optionById = new Map(request.decoder.options.map((option) => [option.id, option]));
  for (const [optionId, value] of Object.entries(decoderOptions)) {
    const option = optionById.get(optionId);
    if (!option) {
      issues.push({
        path: `decoderOptions.${optionId}`,
        code: "unknown-option",
        message: `Decoder option ${optionId} is not exposed by ${request.decoder.id}.`,
        actual: optionId
      });
      continue;
    }

    if (option.values.length > 0 && !option.values.includes(value)) {
      issues.push({
        path: `decoderOptions.${optionId}`,
        code: "invalid-value",
        message: `Decoder option ${optionId} must be one of the inspected allowed values.`,
        expected: option.values,
        actual: value
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, decoderId: decoderId || null, issues };
  }

  return {
    ok: true,
    request: {
      decoderId,
      artifact: request.artifact,
      channelMappings: Object.fromEntries(
        Object.entries(channelMappings).map(([channelId, signalId]) => [channelId, signalId.trim()])
      ),
      decoderOptions: { ...decoderOptions }
    }
  };
};

const writeArtifactToTempFile = async (
  artifact: CaptureArtifactInput,
  tempDir: string | undefined
): Promise<{ dirPath: string; filePath: string }> => {
  const dirPath = await mkdtemp(join(tempDir ?? tmpdir(), "dsview-decode-"));
  const filePath = join(dirPath, "artifact.logic");

  if (artifact.bytes instanceof Uint8Array) {
    await writeFile(filePath, artifact.bytes);
  } else {
    await writeFile(filePath, artifact.text ?? "", "utf8");
  }

  return { dirPath, filePath };
};

const parseDecodeReport = (
  decoderId: string,
  payload: Record<string, unknown>
): DsviewDecoderReport | null => {
  const reportPayload = isRecord(payload.report) ? payload.report : payload;
  const annotations = readRecordArray(reportPayload.annotations);
  const rows = readRecordArray(reportPayload.rows ?? reportPayload.annotation_rows ?? reportPayload.annotationRows);

  if (annotations.length === 0 && rows.length === 0 && !isRecord(payload.report)) {
    return null;
  }

  return {
    decoderId,
    annotations,
    rows,
    raw: payload
  };
};

export const runDsviewDecoder = async (
  request: DsviewDecoderRunRequest,
  options: DsviewDecoderRunOptions
): Promise<DsviewDecoderRunResult> => {
  const artifact = summarizeCaptureArtifact(request.artifact);
  const validation = validateDecodeRequest(request);
  if (!validation.ok) {
    return createValidationFailure(validation.decoderId, artifact, validation.issues);
  }

  const command = options.dsviewCliPath?.trim() || DEFAULT_DSVIEW_CLI_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  let temp: { dirPath: string; filePath: string } | null = null;
  let cleanup = createCleanup(false, null);

  try {
    temp = await writeArtifactToTempFile(validation.request.artifact, options.tempDir);
    const args = buildRunArgs(validation.request, temp.filePath, options);
    const result = await options.executeCommand(command, args, { timeoutMs, maxBufferBytes });
    const payloadResult = parseOutputPayload(combineCommandOutput(result));
    const commandContext = createCommandContext(command, args, result);

    try {
      await rm(temp.dirPath, { recursive: true, force: true });
      cleanup = createCleanup(true, temp.filePath);
    } catch (error) {
      cleanup = createCleanup(true, temp.filePath, error);
    }

    if (!result.ok) {
      if (payloadResult.ok && (payloadResult.payload.code !== undefined || payloadResult.payload.message !== undefined)) {
        return createRunFailure(
          "cli-error",
          validation.request.decoderId,
          artifact,
          commandContext,
          cleanup,
          readString(payloadResult.payload.message) ?? "dsview-cli decode run failed.",
          {
            code: readString(payloadResult.payload.code),
            detail: readString(payloadResult.payload.detail)
          }
        );
      }

      return createRunFailure(
        "command-failed",
        validation.request.decoderId,
        artifact,
        commandContext,
        cleanup,
        `dsview-cli decode run ${result.reason}.`
      );
    }

    if (payloadResult.ok && (payloadResult.payload.code !== undefined || payloadResult.payload.message !== undefined) && payloadResult.payload.report === undefined) {
      return createRunFailure(
        "cli-error",
        validation.request.decoderId,
        artifact,
        commandContext,
        cleanup,
        readString(payloadResult.payload.message) ?? "dsview-cli decode run failed.",
        {
          code: readString(payloadResult.payload.code),
          detail: readString(payloadResult.payload.detail)
        }
      );
    }

    const report = payloadResult.ok ? parseDecodeReport(validation.request.decoderId, payloadResult.payload) : null;
    if (!report) {
      return createRunFailure(
        "malformed-output",
        validation.request.decoderId,
        artifact,
        commandContext,
        cleanup,
        `dsview-cli decode run did not return a decode report for ${validation.request.decoderId}.`
      );
    }

    return {
      ok: true,
      phase: "decode-run",
      decoderId: validation.request.decoderId,
      report,
      artifact,
      command: commandContext,
      cleanup
    };
  } catch (error) {
    if (temp) {
      try {
        await rm(temp.dirPath, { recursive: true, force: true });
        cleanup = createCleanup(true, temp.filePath);
      } catch (cleanupError) {
        cleanup = createCleanup(true, temp.filePath, cleanupError);
      }
    }

    return {
      ok: false,
      phase: "decode-run",
      reason: "command-failed",
      code: null,
      message: error instanceof Error ? error.message : String(error),
      detail: null,
      decoderId: validation.request.decoderId,
      artifact,
      issues: [],
      command: null,
      cleanup
    };
  }
};
