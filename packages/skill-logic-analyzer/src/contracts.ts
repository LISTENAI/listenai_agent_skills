import type {
  AllocationFailure,
  BackendReadinessRecord,
  BackendReadinessState,
  DeviceReadinessState,
  DeviceRecord,
  InventoryBackendKind,
  InventoryDiagnostic,
  InventoryProviderKind,
  LiveCaptureFailure,
  LiveCaptureTuning,
  ReleaseFailure
} from "@listenai/eaw-contracts";
import type {
  CaptureArtifactSummary,
  IncompatibleSessionCaptureFailure,
  LoadCaptureResult,
  UnreadableCaptureInputFailure,
  UnsupportedCaptureAdapterFailure
} from "./capture-contracts.js";

export const VALIDATION_ISSUE_CODES = [
  "required",
  "invalid-type",
  "invalid-value",
  "too-small"
] as const;
export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

export const LOGIC_ANALYZER_START_FAILURE_REASONS = [
  "invalid-request",
  "constraint-rejected",
  "allocation-failed"
] as const;
export type LogicAnalyzerStartFailureReason =
  (typeof LOGIC_ANALYZER_START_FAILURE_REASONS)[number];

export const LOGIC_ANALYZER_END_FAILURE_REASONS = [
  "invalid-request",
  "release-failed"
] as const;
export type LogicAnalyzerEndFailureReason =
  (typeof LOGIC_ANALYZER_END_FAILURE_REASONS)[number];

export const ANALYSIS_EDGE_POLICIES = ["all", "rising", "falling"] as const;
export type AnalysisEdgePolicy = (typeof ANALYSIS_EDGE_POLICIES)[number];

export const ANALYSIS_TIME_REFERENCES = [
  "capture-start",
  "first-transition"
] as const;
export type AnalysisTimeReference = (typeof ANALYSIS_TIME_REFERENCES)[number];

export interface LogicAnalyzerChannelSelection {
  channelId: string;
  label?: string;
}

export interface LogicAnalyzerSamplingConfig {
  sampleRateHz: number;
  captureDurationMs: number;
  channels: readonly LogicAnalyzerChannelSelection[];
}

export interface LogicAnalyzerAnalysisWindow {
  startSampleIndex?: number;
  endSampleIndex?: number;
}

export interface LogicAnalyzerAnalysisConfig {
  focusChannelIds: readonly string[];
  edgePolicy: AnalysisEdgePolicy;
  includePulseWidths: boolean;
  timeReference: AnalysisTimeReference;
  window?: LogicAnalyzerAnalysisWindow;
}

export interface StartLogicAnalyzerSessionRequest {
  deviceId: string;
  ownerSkillId: string;
  requestedAt: string;
  sampling: LogicAnalyzerSamplingConfig;
  analysis: LogicAnalyzerAnalysisConfig;
}

export interface LogicAnalyzerSessionRecord {
  sessionId: string;
  deviceId: string;
  ownerSkillId: string;
  startedAt: string;
  device: DeviceRecord;
  sampling: LogicAnalyzerSamplingConfig;
  analysis: LogicAnalyzerAnalysisConfig;
}

export interface EndLogicAnalyzerSessionRequest {
  sessionId: string;
  deviceId: string;
  ownerSkillId: string;
  endedAt: string;
}

export interface LogicAnalyzerValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
}

export const LOGIC_ANALYZER_CONSTRAINT_ISSUE_CODES = [
  "device-not-found",
  "backend-not-ready",
  "device-not-ready",
  "unsupported-device",
  "missing-dslogic-identity",
  "empty-channel-selection",
  "duplicate-channel-selection",
  "channel-count-exceeds-device-limit"
] as const;
export type LogicAnalyzerConstraintIssueCode =
  (typeof LOGIC_ANALYZER_CONSTRAINT_ISSUE_CODES)[number];

export interface LogicAnalyzerConstraintIssue {
  path: string;
  code: LogicAnalyzerConstraintIssueCode;
  message: string;
}

export interface LogicAnalyzerSessionConstraintReport {
  request: {
    deviceId: string;
    requestedChannelIds: readonly string[];
    requestedChannelCount: number;
    distinctChannelCount: number;
    sampleRateHz: number;
  };
  device: DeviceRecord | null;
  evaluatedDeviceReadiness: DeviceReadinessState | "missing";
  deviceDiagnostics: readonly InventoryDiagnostic[];
  backendReadiness: readonly BackendReadinessRecord[];
  evaluatedBackendReadiness: BackendReadinessState | "missing";
  snapshotDiagnostics: readonly InventoryDiagnostic[];
  issues: readonly LogicAnalyzerConstraintIssue[];
}

export interface LogicAnalyzerSessionConstraintAccepted {
  ok: true;
  report: LogicAnalyzerSessionConstraintReport;
}

export interface LogicAnalyzerStartConstraintFailure {
  ok: false;
  reason: "constraint-rejected";
  report: LogicAnalyzerSessionConstraintReport;
}

export type LogicAnalyzerSessionConstraintEvaluation =
  | LogicAnalyzerSessionConstraintAccepted
  | LogicAnalyzerStartConstraintFailure;

export interface LogicAnalyzerStartValidationFailure {
  ok: false;
  reason: "invalid-request";
  issues: readonly LogicAnalyzerValidationIssue[];
}

export interface LogicAnalyzerStartAllocationFailure {
  ok: false;
  reason: "allocation-failed";
  allocation: AllocationFailure;
  inventory: readonly DeviceRecord[];
}

export interface LogicAnalyzerStartSuccess {
  ok: true;
  session: LogicAnalyzerSessionRecord;
}

export type StartLogicAnalyzerSessionResult =
  | LogicAnalyzerStartSuccess
  | LogicAnalyzerStartValidationFailure
  | LogicAnalyzerStartConstraintFailure
  | LogicAnalyzerStartAllocationFailure;

export interface LogicAnalyzerEndValidationFailure {
  ok: false;
  reason: "invalid-request";
  issues: readonly LogicAnalyzerValidationIssue[];
}

export interface LogicAnalyzerEndReleaseFailure {
  ok: false;
  reason: "release-failed";
  release: ReleaseFailure;
}

export interface LogicAnalyzerEndSuccess {
  ok: true;
  device: DeviceRecord;
}

export type EndLogicAnalyzerSessionResult =
  | LogicAnalyzerEndSuccess
  | LogicAnalyzerEndValidationFailure
  | LogicAnalyzerEndReleaseFailure;

export const LOGIC_ANALYZER_CAPTURE_FAILURE_REASONS = [
  "invalid-request",
  "capture-runtime-failed",
  "malformed-artifact",
  "load-capture-failed"
] as const;
export type LogicAnalyzerCaptureFailureReason =
  (typeof LOGIC_ANALYZER_CAPTURE_FAILURE_REASONS)[number];

export interface CaptureLogicAnalyzerSessionRequest {
  session: LogicAnalyzerSessionRecord;
  requestedAt: string;
  timeoutMs?: number;
  captureTuning?: LiveCaptureTuning;
}

export interface LogicAnalyzerCaptureValidationFailure {
  ok: false;
  reason: "invalid-request";
  issues: readonly LogicAnalyzerValidationIssue[];
}

export interface LogicAnalyzerCaptureRuntimeFailure {
  ok: false;
  reason: "capture-runtime-failed";
  session: LogicAnalyzerSessionRecord;
  requestedAt: string;
  captureRuntime: LiveCaptureFailure;
}

export interface LogicAnalyzerCaptureArtifactFailure {
  ok: false;
  reason: "malformed-artifact";
  session: LogicAnalyzerSessionRecord;
  requestedAt: string;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  artifactSummary: CaptureArtifactSummary;
  issues: readonly LogicAnalyzerValidationIssue[];
}

export interface LogicAnalyzerCaptureLoadFailure {
  ok: false;
  reason: "load-capture-failed";
  session: LogicAnalyzerSessionRecord;
  requestedAt: string;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  artifactSummary: CaptureArtifactSummary;
  loadCapture:
    | UnsupportedCaptureAdapterFailure
    | UnreadableCaptureInputFailure
    | IncompatibleSessionCaptureFailure;
}

export interface LogicAnalyzerCaptureSuccess {
  ok: true;
  session: LogicAnalyzerSessionRecord;
  requestedAt: string;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  artifactSummary: CaptureArtifactSummary;
  capture: Extract<LoadCaptureResult, { ok: true }>;
}

export type CaptureLogicAnalyzerSessionResult =
  | LogicAnalyzerCaptureSuccess
  | LogicAnalyzerCaptureValidationFailure
  | LogicAnalyzerCaptureRuntimeFailure
  | LogicAnalyzerCaptureArtifactFailure
  | LogicAnalyzerCaptureLoadFailure;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly LogicAnalyzerValidationIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

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

  if (!isNonEmptyString(value)) {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be a non-empty string.`
    });
  }
};

const validateChannels = (
  value: unknown,
  issues: LogicAnalyzerValidationIssue[]
): void => {
  if (!Array.isArray(value)) {
    issues.push({
      path: "sampling.channels",
      code: "invalid-type",
      message: "sampling.channels must be an array of channel selections."
    });
    return;
  }

  if (value.length === 0) {
    issues.push({
      path: "sampling.channels",
      code: "too-small",
      message: "sampling.channels must contain at least one channel."
    });
  }

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push({
        path: `sampling.channels[${index}]`,
        code: "invalid-type",
        message: `sampling.channels[${index}] must be an object.`
      });
      return;
    }

    pushRequiredStringIssue(
      issues,
      `sampling.channels[${index}].channelId`,
      entry.channelId
    );

    if (
      entry.label !== undefined &&
      entry.label !== null &&
      typeof entry.label !== "string"
    ) {
      issues.push({
        path: `sampling.channels[${index}].label`,
        code: "invalid-type",
        message: `sampling.channels[${index}].label must be a string when provided.`
      });
    }
  });
};

const validateSampling = (
  value: unknown,
  issues: LogicAnalyzerValidationIssue[]
): void => {
  if (!isRecord(value)) {
    issues.push({
      path: "sampling",
      code: "invalid-type",
      message: "sampling must be an object." 
    });
    return;
  }

  if (typeof value.sampleRateHz !== "number" || Number.isNaN(value.sampleRateHz)) {
    issues.push({
      path: "sampling.sampleRateHz",
      code: "invalid-type",
      message: "sampling.sampleRateHz must be a number."
    });
  } else if (value.sampleRateHz <= 0) {
    issues.push({
      path: "sampling.sampleRateHz",
      code: "too-small",
      message: "sampling.sampleRateHz must be greater than 0."
    });
  }

  if (
    typeof value.captureDurationMs !== "number" ||
    Number.isNaN(value.captureDurationMs)
  ) {
    issues.push({
      path: "sampling.captureDurationMs",
      code: "invalid-type",
      message: "sampling.captureDurationMs must be a number."
    });
  } else if (value.captureDurationMs <= 0) {
    issues.push({
      path: "sampling.captureDurationMs",
      code: "too-small",
      message: "sampling.captureDurationMs must be greater than 0."
    });
  }

  validateChannels(value.channels, issues);
};

const validateAnalysisWindow = (
  value: unknown,
  issues: LogicAnalyzerValidationIssue[]
): void => {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "analysis.window",
      code: "invalid-type",
      message: "analysis.window must be an object when provided."
    });
    return;
  }

  const startSampleIndex = value.startSampleIndex;
  const endSampleIndex = value.endSampleIndex;

  if (
    startSampleIndex !== undefined &&
    (typeof startSampleIndex !== "number" || Number.isNaN(startSampleIndex))
  ) {
    issues.push({
      path: "analysis.window.startSampleIndex",
      code: "invalid-type",
      message: "analysis.window.startSampleIndex must be a number when provided."
    });
  } else if (typeof startSampleIndex === "number" && startSampleIndex < 0) {
    issues.push({
      path: "analysis.window.startSampleIndex",
      code: "too-small",
      message: "analysis.window.startSampleIndex must be 0 or greater."
    });
  }

  if (
    endSampleIndex !== undefined &&
    (typeof endSampleIndex !== "number" || Number.isNaN(endSampleIndex))
  ) {
    issues.push({
      path: "analysis.window.endSampleIndex",
      code: "invalid-type",
      message: "analysis.window.endSampleIndex must be a number when provided."
    });
  } else if (typeof endSampleIndex === "number" && endSampleIndex < 0) {
    issues.push({
      path: "analysis.window.endSampleIndex",
      code: "too-small",
      message: "analysis.window.endSampleIndex must be 0 or greater."
    });
  }

  if (
    typeof startSampleIndex === "number" &&
    typeof endSampleIndex === "number" &&
    endSampleIndex < startSampleIndex
  ) {
    issues.push({
      path: "analysis.window",
      code: "invalid-value",
      message: "analysis.window.endSampleIndex must be greater than or equal to startSampleIndex."
    });
  }
};

const validateAnalysis = (
  value: unknown,
  issues: LogicAnalyzerValidationIssue[]
): void => {
  if (!isRecord(value)) {
    issues.push({
      path: "analysis",
      code: "invalid-type",
      message: "analysis must be an object."
    });
    return;
  }

  if (!Array.isArray(value.focusChannelIds)) {
    issues.push({
      path: "analysis.focusChannelIds",
      code: "invalid-type",
      message: "analysis.focusChannelIds must be an array of channel IDs."
    });
  } else {
    value.focusChannelIds.forEach((entry, index) => {
      if (!isNonEmptyString(entry)) {
        issues.push({
          path: `analysis.focusChannelIds[${index}]`,
          code: "invalid-type",
          message: `analysis.focusChannelIds[${index}] must be a non-empty string.`
        });
      }
    });
  }

  if (!ANALYSIS_EDGE_POLICIES.includes(value.edgePolicy as AnalysisEdgePolicy)) {
    issues.push({
      path: "analysis.edgePolicy",
      code: "invalid-value",
      message: `analysis.edgePolicy must be one of ${ANALYSIS_EDGE_POLICIES.join(", ")}.`
    });
  }

  if (typeof value.includePulseWidths !== "boolean") {
    issues.push({
      path: "analysis.includePulseWidths",
      code: "invalid-type",
      message: "analysis.includePulseWidths must be a boolean."
    });
  }

  if (
    !ANALYSIS_TIME_REFERENCES.includes(
      value.timeReference as AnalysisTimeReference
    )
  ) {
    issues.push({
      path: "analysis.timeReference",
      code: "invalid-value",
      message: `analysis.timeReference must be one of ${ANALYSIS_TIME_REFERENCES.join(", ")}.`
    });
  }

  validateAnalysisWindow(value.window, issues);
};

const CAPTURE_TUNING_KEYS = [
  "operation",
  "channel",
  "stop",
  "filter",
  "threshold"
] as const;

const validateCaptureTuning = (
  value: unknown,
  issues: LogicAnalyzerValidationIssue[]
): void => {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path: "captureTuning",
      code: "invalid-type",
      message: "captureTuning must be an object when provided."
    });
    return;
  }

  for (const key of CAPTURE_TUNING_KEYS) {
    const token = value[key];
    if (token === undefined) {
      continue;
    }

    if (!isNonEmptyString(token)) {
      issues.push({
        path: `captureTuning.${key}`,
        code: "invalid-type",
        message: `captureTuning.${key} must be a non-empty string when provided.`
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

export const validateStartLogicAnalyzerSessionRequest = (
  value: unknown
): ValidationResult<StartLogicAnalyzerSessionRequest> => {
  const issues: LogicAnalyzerValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-type",
          message: "Start session request must be an object."
        }
      ]
    };
  }

  pushRequiredStringIssue(issues, "deviceId", value.deviceId);
  pushRequiredStringIssue(issues, "ownerSkillId", value.ownerSkillId);
  pushRequiredStringIssue(issues, "requestedAt", value.requestedAt);
  validateSampling(value.sampling, issues);
  validateAnalysis(value.analysis, issues);

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  return {
    ok: true,
    value: {
      deviceId: value.deviceId as string,
      ownerSkillId: value.ownerSkillId as string,
      requestedAt: value.requestedAt as string,
      sampling: value.sampling as LogicAnalyzerSamplingConfig,
      analysis: value.analysis as LogicAnalyzerAnalysisConfig
    }
  };
};

export const validateEndLogicAnalyzerSessionRequest = (
  value: unknown
): ValidationResult<EndLogicAnalyzerSessionRequest> => {
  const issues: LogicAnalyzerValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-type",
          message: "End session request must be an object."
        }
      ]
    };
  }

  pushRequiredStringIssue(issues, "sessionId", value.sessionId);
  pushRequiredStringIssue(issues, "deviceId", value.deviceId);
  pushRequiredStringIssue(issues, "ownerSkillId", value.ownerSkillId);
  pushRequiredStringIssue(issues, "endedAt", value.endedAt);

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  return {
    ok: true,
    value: {
      sessionId: value.sessionId as string,
      deviceId: value.deviceId as string,
      ownerSkillId: value.ownerSkillId as string,
      endedAt: value.endedAt as string
    }
  };
};

export const validateCaptureLogicAnalyzerSessionRequest = (
  value: unknown
): ValidationResult<CaptureLogicAnalyzerSessionRequest> => {
  const issues: LogicAnalyzerValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-type",
          message: "Capture session request must be an object."
        }
      ]
    };
  }

  pushRequiredStringIssue(issues, "requestedAt", value.requestedAt);

  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== "number" || Number.isNaN(value.timeoutMs)) {
      issues.push({
        path: "timeoutMs",
        code: "invalid-type",
        message: "timeoutMs must be a number when provided."
      });
    } else if (value.timeoutMs <= 0) {
      issues.push({
        path: "timeoutMs",
        code: "too-small",
        message: "timeoutMs must be greater than 0 when provided."
      });
    }
  }

  validateCaptureTuning(value.captureTuning, issues);

  if (!isRecord(value.session)) {
    issues.push({
      path: "session",
      code: "required",
      message: "session is required."
    });
  } else {
    const session = value.session;
    pushRequiredStringIssue(issues, "session.sessionId", session.sessionId);
    pushRequiredStringIssue(issues, "session.deviceId", session.deviceId);
    pushRequiredStringIssue(issues, "session.ownerSkillId", session.ownerSkillId);
    pushRequiredStringIssue(issues, "session.startedAt", session.startedAt);

    if (!isRecord(session.device)) {
      issues.push({
        path: "session.device",
        code: "required",
        message: "session.device is required."
      });
    } else {
      pushRequiredStringIssue(
        issues,
        "session.device.deviceId",
        session.device.deviceId
      );
    }

    validateSampling(session.sampling, issues);
    validateAnalysis(session.analysis, issues);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  const captureTuning = normalizeCaptureTuning(value.captureTuning);

  return {
    ok: true,
    value: {
      session: value.session as LogicAnalyzerSessionRecord,
      requestedAt: value.requestedAt as string,
      timeoutMs: value.timeoutMs as number | undefined,
      ...(captureTuning ? { captureTuning } : {})
    }
  };
};
