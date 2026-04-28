import type {
  CaptureLogicAnalyzerSessionResult,
  EndLogicAnalyzerSessionRequest,
  EndLogicAnalyzerSessionResult,
  LogicAnalyzerSessionRecord,
  LogicAnalyzerValidationIssue,
  StartLogicAnalyzerSessionRequest,
  StartLogicAnalyzerSessionResult
} from "./contracts.js";
import {
  createLogicAnalyzerSkill,
  type LogicAnalyzerSkill
} from "./logic-analyzer-skill.js";
import type {
  CaptureArtifactInput,
  IncompatibleSessionCaptureFailure,
  LoadCaptureResult,
  UnreadableCaptureInputFailure,
  UnsupportedCaptureAdapterFailure
} from "./capture-contracts.js";
import {
  loadLogicCapture,
  type CaptureLoaderOptions
} from "./capture-loader.js";
import {
  analyzeWaveformCapture,
  markProtocolDecodeAvailable
} from "./waveform-analyzer.js";
import type { WaveformAnalysisResult } from "./analysis-contracts.js";
import type { DsviewDecodeCommandRunner, DsviewDecoderDetails } from "./decoder-discovery.js";
import { runDsviewDecoder } from "./decoder-runner.js";
import type {
  DsviewDecoderOptionValue,
  DsviewDecoderRunFailure,
  DsviewDecoderRunOptions,
  DsviewDecoderRunSuccess,
  DsviewDecoderValidationIssue
} from "./decoder-runner.js";
import { summarizeCaptureArtifact } from "./capture-contracts.js";
import type { LiveCaptureTuning, SnapshotResourceManager } from "@listenai/eaw-contracts";

export const GENERIC_LOGIC_ANALYZER_MODES = ["artifact", "live"] as const;
export type GenericLogicAnalyzerMode =
  (typeof GENERIC_LOGIC_ANALYZER_MODES)[number];

export const GENERIC_LOGIC_ANALYZER_PHASES = [
  "request-validation",
  "start-session",
  "live-capture",
  "load-capture",
  "decode-validation",
  "decode-run",
  "completed"
] as const;
export type GenericLogicAnalyzerPhase =
  (typeof GENERIC_LOGIC_ANALYZER_PHASES)[number];

export interface GenericLogicAnalyzerCleanupConfig {
  endedAt: string;
}

export interface GenericLogicAnalyzerDecodeConfig {
  decoderId: string;
  decoder: DsviewDecoderDetails;
  channelMappings: Readonly<Record<string, string>>;
  decoderOptions?: Readonly<Record<string, DsviewDecoderOptionValue>>;
}

export interface GenericLogicAnalyzerOfflineRequest {
  mode?: "artifact";
  session: StartLogicAnalyzerSessionRequest;
  artifact: CaptureArtifactInput;
  decode?: GenericLogicAnalyzerDecodeConfig;
  cleanup: GenericLogicAnalyzerCleanupConfig;
}

export interface GenericLogicAnalyzerLiveCaptureConfig {
  requestedAt: string;
  timeoutMs?: number;
  captureTuning?: LiveCaptureTuning;
}

export interface GenericLogicAnalyzerLiveRequest {
  mode: "live";
  session: StartLogicAnalyzerSessionRequest;
  capture: GenericLogicAnalyzerLiveCaptureConfig;
  cleanup: GenericLogicAnalyzerCleanupConfig;
}

export type GenericLogicAnalyzerRequest =
  | GenericLogicAnalyzerOfflineRequest
  | GenericLogicAnalyzerLiveRequest;

type NormalizedGenericLogicAnalyzerRequest =
  | (GenericLogicAnalyzerOfflineRequest & { mode: "artifact" })
  | GenericLogicAnalyzerLiveRequest;

export interface GenericLogicAnalyzerRequestValidationFailure {
  ok: false;
  phase: "request-validation";
  issues: readonly LogicAnalyzerValidationIssue[];
  cleanup: {
    attempted: false;
    reason: "not-started";
  };
}

export interface GenericLogicAnalyzerStartFailure {
  ok: false;
  phase: "start-session";
  startSession: Exclude<StartLogicAnalyzerSessionResult, { ok: true }>;
  cleanup: {
    attempted: false;
    reason: "not-started";
  };
}

export interface GenericLogicAnalyzerCleanupAttempt {
  attempted: true;
  request: EndLogicAnalyzerSessionRequest;
  result: EndLogicAnalyzerSessionResult;
}

export type GenericLogicAnalyzerCleanupReport =
  | GenericLogicAnalyzerRequestValidationFailure["cleanup"]
  | GenericLogicAnalyzerStartFailure["cleanup"]
  | GenericLogicAnalyzerCleanupAttempt;

export interface GenericLogicAnalyzerOfflineLoadFailure {
  ok: false;
  phase: "load-capture";
  session: LogicAnalyzerSessionRecord;
  loadCapture:
    | UnsupportedCaptureAdapterFailure
    | UnreadableCaptureInputFailure
    | IncompatibleSessionCaptureFailure;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export interface GenericLogicAnalyzerLiveCaptureRuntimeFailure {
  ok: false;
  phase: "live-capture";
  session: LogicAnalyzerSessionRecord;
  captureSession: Extract<
    CaptureLogicAnalyzerSessionResult,
    { ok: false; reason: "capture-runtime-failed" }
  >;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export interface GenericLogicAnalyzerLiveCaptureValidationFailure {
  ok: false;
  phase: "live-capture";
  session: LogicAnalyzerSessionRecord;
  captureSession: Extract<
    CaptureLogicAnalyzerSessionResult,
    { ok: false; reason: "invalid-request" }
  >;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export interface GenericLogicAnalyzerLiveCaptureArtifactFailure {
  ok: false;
  phase: "live-capture";
  session: LogicAnalyzerSessionRecord;
  captureSession: Extract<
    CaptureLogicAnalyzerSessionResult,
    { ok: false; reason: "malformed-artifact" }
  >;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export type GenericLogicAnalyzerLiveCaptureFailure =
  | GenericLogicAnalyzerLiveCaptureValidationFailure
  | GenericLogicAnalyzerLiveCaptureRuntimeFailure
  | GenericLogicAnalyzerLiveCaptureArtifactFailure;

export interface GenericLogicAnalyzerLiveLoadFailure {
  ok: false;
  phase: "load-capture";
  session: LogicAnalyzerSessionRecord;
  captureSession: Extract<
    CaptureLogicAnalyzerSessionResult,
    { ok: false; reason: "load-capture-failed" }
  >;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export type GenericLogicAnalyzerLoadFailure =
  | GenericLogicAnalyzerOfflineLoadFailure
  | GenericLogicAnalyzerLiveLoadFailure;

export interface GenericLogicAnalyzerDecodeFailure {
  ok: false;
  phase: "decode-validation" | "decode-run";
  session: LogicAnalyzerSessionRecord;
  capture: Extract<LoadCaptureResult, { ok: true }>;
  analysis: WaveformAnalysisResult;
  decode: DsviewDecoderRunFailure;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export interface GenericLogicAnalyzerOfflineSuccess {
  ok: true;
  phase: "completed";
  session: LogicAnalyzerSessionRecord;
  capture: Extract<LoadCaptureResult, { ok: true }>;
  analysis: WaveformAnalysisResult;
  decode?: DsviewDecoderRunSuccess;
}

export interface GenericLogicAnalyzerLiveSuccess {
  ok: true;
  phase: "completed";
  session: LogicAnalyzerSessionRecord;
  capture: Extract<LoadCaptureResult, { ok: true }>;
  analysis: WaveformAnalysisResult;
  captureSession: Extract<CaptureLogicAnalyzerSessionResult, { ok: true }>;
}

export type GenericLogicAnalyzerSuccess =
  | GenericLogicAnalyzerOfflineSuccess
  | GenericLogicAnalyzerLiveSuccess;

export type GenericLogicAnalyzerResult =
  | GenericLogicAnalyzerSuccess
  | GenericLogicAnalyzerRequestValidationFailure
  | GenericLogicAnalyzerStartFailure
  | GenericLogicAnalyzerLiveCaptureFailure
  | GenericLogicAnalyzerLoadFailure
  | GenericLogicAnalyzerDecodeFailure;

export type GenericLogicAnalyzerDecodeRunnerOptions = Omit<
  DsviewDecoderRunOptions,
  "executeCommand"
> & {
  executeCommand?: DsviewDecodeCommandRunner;
};

export interface GenericLogicAnalyzerSkillOptions {
  createSessionId?: () => string;
  captureLoaderOptions?: CaptureLoaderOptions;
  decodeRunnerOptions?: GenericLogicAnalyzerDecodeRunnerOptions;
}

export interface GenericLogicAnalyzerSkill {
  run(request: unknown): Promise<GenericLogicAnalyzerResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const pushRequiredObjectIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined || value === null) {
    issues.push({
      path,
      code: "required",
      message: `${path} is required.`
    });
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be an object.`
    });
  }
};

const pushRequiredStringIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined || value === null || value === "") {
    issues.push({
      path,
      code: "required",
      message: `${path} is required.`
    });
    return;
  }

  if (typeof value !== "string") {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be a string.`
    });
  }
};

const pushPositiveNumberIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be a number when provided.`
    });
    return;
  }

  if (value <= 0) {
    issues.push({
      path,
      code: "too-small",
      message: `${path} must be greater than 0 when provided.`
    });
  }
};

const CAPTURE_TUNING_KEYS = [
  "operation",
  "channel",
  "stop",
  "filter",
  "threshold"
] as const;

const pushCaptureTuningIssues = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be an object when provided.`
    });
    return;
  }

  for (const key of CAPTURE_TUNING_KEYS) {
    const token = value[key];
    if (token === undefined) {
      continue;
    }

    if (typeof token !== "string" || token.trim().length === 0) {
      issues.push({
        path: `${path}.${key}`,
        code: "invalid-type",
        message: `${path}.${key} must be a non-empty string when provided.`
      });
    }
  }
};

const normalizeCaptureTuning = (value: unknown): LiveCaptureTuning | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const tuning: LiveCaptureTuning = {};
  for (const key of CAPTURE_TUNING_KEYS) {
    const token = value[key];
    if (typeof token === "string") {
      tuning[key] = token;
    }
  }

  return Object.keys(tuning).length > 0 ? tuning : undefined;
};

const pushArtifactPayloadIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (!isRecord(value)) {
    return;
  }

  const hasText = typeof value.text === "string" && value.text.length > 0;
  const hasBytes =
    value.bytes instanceof Uint8Array && value.bytes.byteLength > 0;

  if (!hasText && !hasBytes) {
    issues.push({
      path,
      code: "required",
      message: `${path} must include non-empty text or bytes.`
    });
  }
};

export const validateGenericLogicAnalyzerRequest = (
  value: unknown
):
  | { ok: true; value: NormalizedGenericLogicAnalyzerRequest }
  | { ok: false; issues: readonly LogicAnalyzerValidationIssue[] } => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-type",
          message: "Generic logic analyzer request must be an object."
        }
      ]
    };
  }

  const issues: LogicAnalyzerValidationIssue[] = [];
  const mode = value.mode;

  if (
    mode !== undefined &&
    mode !== GENERIC_LOGIC_ANALYZER_MODES[0] &&
    mode !== GENERIC_LOGIC_ANALYZER_MODES[1]
  ) {
    issues.push({
      path: "mode",
      code: "invalid-value",
      message: `mode must be one of ${GENERIC_LOGIC_ANALYZER_MODES.join(", ")}.`
    });
  }

  const normalizedMode: GenericLogicAnalyzerMode =
    mode === "live" ? "live" : "artifact";

  pushRequiredObjectIssue(issues, "session", value.session);
  pushRequiredObjectIssue(issues, "cleanup", value.cleanup);

  if (isRecord(value.cleanup)) {
    pushRequiredStringIssue(issues, "cleanup.endedAt", value.cleanup.endedAt);
  }

  if (normalizedMode === "live") {
    pushRequiredObjectIssue(issues, "capture", value.capture);

    if (isRecord(value.capture)) {
      pushRequiredStringIssue(
        issues,
        "capture.requestedAt",
        value.capture.requestedAt
      );
      pushPositiveNumberIssue(issues, "capture.timeoutMs", value.capture.timeoutMs);
      pushCaptureTuningIssues(
        issues,
        "capture.captureTuning",
        value.capture.captureTuning
      );
    }
  } else {
    pushRequiredObjectIssue(issues, "artifact", value.artifact);
    pushArtifactPayloadIssue(issues, "artifact", value.artifact);

    if (value.decode !== undefined && !isRecord(value.decode)) {
      issues.push({
        path: "decode",
        code: "invalid-type",
        message: "decode must be an object when provided."
      });
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  if (normalizedMode === "live") {
    const captureTuning = normalizeCaptureTuning(
      (value.capture as { captureTuning?: unknown }).captureTuning
    );

    return {
      ok: true,
      value: {
        mode: "live",
        session: value.session as StartLogicAnalyzerSessionRequest,
        capture: {
          requestedAt: (value.capture as { requestedAt: string }).requestedAt,
          timeoutMs: (value.capture as { timeoutMs?: number }).timeoutMs,
          ...(captureTuning ? { captureTuning } : {})
        },
        cleanup: {
          endedAt: (value.cleanup as { endedAt: string }).endedAt
        }
      }
    };
  }

  return {
    ok: true,
    value: {
      mode: "artifact",
      session: value.session as StartLogicAnalyzerSessionRequest,
      artifact: value.artifact as CaptureArtifactInput,
      ...(value.decode !== undefined
        ? { decode: value.decode as GenericLogicAnalyzerDecodeConfig }
        : {}),
      cleanup: {
        endedAt: (value.cleanup as { endedAt: string }).endedAt
      }
    }
  };
};

const buildCleanupRequest = (
  request: NormalizedGenericLogicAnalyzerRequest,
  session: LogicAnalyzerSessionRecord
): EndLogicAnalyzerSessionRequest => ({
  sessionId: session.sessionId,
  deviceId: session.deviceId,
  ownerSkillId: session.ownerSkillId,
  endedAt: request.cleanup.endedAt
});

const attemptCleanup = async (
  sessionSkill: GenericLogicAnalyzerSessionSkill,
  request: NormalizedGenericLogicAnalyzerRequest,
  session: LogicAnalyzerSessionRecord
): Promise<GenericLogicAnalyzerCleanupAttempt> => {
  const cleanupRequest = buildCleanupRequest(request, session);

  return {
    attempted: true,
    request: cleanupRequest,
    result: await sessionSkill.endSession(cleanupRequest)
  };
};

const analyzeCompletedCapture = (
  session: LogicAnalyzerSessionRecord,
  capture: Extract<LoadCaptureResult, { ok: true }>
): WaveformAnalysisResult =>
  analyzeWaveformCapture(capture.capture, session.analysis);

const createMissingDecodeRunnerFailure = (
  request: GenericLogicAnalyzerDecodeConfig,
  artifact: CaptureArtifactInput
): DsviewDecoderRunFailure => {
  const issue: DsviewDecoderValidationIssue = {
    path: "options.decodeRunnerOptions.executeCommand",
    code: "required",
    message: "decodeRunnerOptions.executeCommand is required when decode is provided."
  };

  return {
    ok: false,
    phase: "decode-validation",
    reason: "validation-failed",
    code: "decode-validation-failed",
    message: "Decode request failed validation.",
    detail: null,
    decoderId: typeof request.decoderId === "string" && request.decoderId.trim().length > 0
      ? request.decoderId.trim()
      : null,
    artifact: summarizeCaptureArtifact(artifact),
    issues: [issue],
    command: null,
    cleanup: {
      attempted: false,
      ok: false,
      path: null,
      message: null
    }
  };
};

const runRequestedDecode = async (
  request: GenericLogicAnalyzerDecodeConfig,
  artifact: CaptureArtifactInput,
  options: GenericLogicAnalyzerSkillOptions
): Promise<DsviewDecoderRunSuccess | DsviewDecoderRunFailure> => {
  const executeCommand = options.decodeRunnerOptions?.executeCommand;
  if (!executeCommand) {
    return createMissingDecodeRunnerFailure(request, artifact);
  }

  return runDsviewDecoder(
    {
      decoderId: request.decoderId,
      decoder: request.decoder,
      artifact,
      channelMappings: request.channelMappings,
      decoderOptions: request.decoderOptions
    },
    {
      ...options.decodeRunnerOptions,
      executeCommand
    }
  );
};

const runOfflineGenericLogicAnalyzer = async (
  sessionSkill: GenericLogicAnalyzerSessionSkill,
  request: Extract<NormalizedGenericLogicAnalyzerRequest, { mode: "artifact" }>,
  session: LogicAnalyzerSessionRecord,
  options: GenericLogicAnalyzerSkillOptions
): Promise<GenericLogicAnalyzerResult> => {
  const capture = loadLogicCapture(
    {
      session,
      artifact: request.artifact
    },
    options.captureLoaderOptions
  );

  if (!capture.ok) {
    return {
      ok: false,
      phase: "load-capture",
      session,
      loadCapture: capture,
      cleanup: await attemptCleanup(sessionSkill, request, session)
    };
  }

  const analysis = analyzeCompletedCapture(session, capture);

  if (request.decode) {
    const decode = await runRequestedDecode(request.decode, request.artifact, options);
    if (!decode.ok) {
      return {
        ok: false,
        phase: decode.phase,
        session,
        capture,
        analysis,
        decode,
        cleanup: await attemptCleanup(sessionSkill, request, session)
      };
    }

    return {
      ok: true,
      phase: "completed",
      session,
      capture,
      analysis: markProtocolDecodeAvailable(analysis),
      decode
    };
  }

  return {
    ok: true,
    phase: "completed",
    session,
    capture,
    analysis
  };
};

const runLiveGenericLogicAnalyzer = async (
  sessionSkill: GenericLogicAnalyzerSessionSkill,
  request: GenericLogicAnalyzerLiveRequest,
  session: LogicAnalyzerSessionRecord
): Promise<GenericLogicAnalyzerResult> => {
  const captureSession = await sessionSkill.captureSession({
    session,
    requestedAt: request.capture.requestedAt,
    timeoutMs: request.capture.timeoutMs,
    captureTuning: request.capture.captureTuning
  });

  if (!captureSession.ok) {
    const cleanup = await attemptCleanup(sessionSkill, request, session);

    if (captureSession.reason === "load-capture-failed") {
      return {
        ok: false,
        phase: "load-capture",
        session,
        captureSession,
        cleanup
      };
    }

    if (captureSession.reason === "invalid-request") {
      return {
        ok: false,
        phase: "live-capture",
        session,
        captureSession,
        cleanup
      };
    }

    if (captureSession.reason === "capture-runtime-failed") {
      return {
        ok: false,
        phase: "live-capture",
        session,
        captureSession,
        cleanup
      };
    }

    return {
      ok: false,
      phase: "live-capture",
      session,
      captureSession,
      cleanup
    };
  }

  return {
    ok: true,
    phase: "completed",
    session,
    capture: captureSession.capture,
    analysis: analyzeCompletedCapture(session, captureSession.capture),
    captureSession
  };
};

export const runGenericLogicAnalyzer = async (
  resourceManager: SnapshotResourceManager,
  request: unknown,
  options: GenericLogicAnalyzerSkillOptions = {}
): Promise<GenericLogicAnalyzerResult> => {
  const validation = validateGenericLogicAnalyzerRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      phase: "request-validation",
      issues: validation.issues,
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    };
  }

  const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
    createSessionId: options.createSessionId,
    captureLoaderOptions: options.captureLoaderOptions
  });
  const startSession = await sessionSkill.startSession(validation.value.session);

  if (!startSession.ok) {
    return {
      ok: false,
      phase: "start-session",
      startSession,
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    };
  }

  if (validation.value.mode === "live") {
    return runLiveGenericLogicAnalyzer(
      sessionSkill,
      validation.value,
      startSession.session
    );
  }

  return runOfflineGenericLogicAnalyzer(
    sessionSkill,
    validation.value,
    startSession.session,
    options
  );
};

export const createGenericLogicAnalyzerSkill = (
  resourceManager: SnapshotResourceManager,
  options: GenericLogicAnalyzerSkillOptions = {}
): GenericLogicAnalyzerSkill => ({
  run(request: unknown): Promise<GenericLogicAnalyzerResult> {
    return runGenericLogicAnalyzer(resourceManager, request, options);
  }
});

export type GenericLogicAnalyzerSessionSkill = Pick<
  LogicAnalyzerSkill,
  "startSession" | "captureSession" | "endSession"
>;
