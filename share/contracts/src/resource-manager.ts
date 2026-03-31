import type {
  AllocationRequest,
  AllocationResult,
  DeviceRecord,
  InventoryBackendKind,
  InventoryDiagnostic,
  InventoryProviderKind,
  InventorySnapshot,
  ReleaseRequest,
  ReleaseResult
} from "./contracts.js";

export const LIVE_CAPTURE_FAILURE_PHASES = [
  "validate-session",
  "spawn-runner",
  "await-runner",
  "collect-artifact"
] as const;
export type LiveCaptureFailurePhase =
  (typeof LIVE_CAPTURE_FAILURE_PHASES)[number];

export const LIVE_CAPTURE_FAILURE_KINDS = [
  "unsupported-runtime",
  "spawn-failed",
  "runner-exited",
  "timeout",
  "aborted",
  "malformed-output"
] as const;
export type LiveCaptureFailureKind =
  (typeof LIVE_CAPTURE_FAILURE_KINDS)[number];

export interface LiveCaptureChannelSelection {
  channelId: string;
  label?: string;
}

export interface LiveCaptureSamplingConfig {
  sampleRateHz: number;
  captureDurationMs: number;
  channels: readonly LiveCaptureChannelSelection[];
}

export interface LiveCaptureSession {
  sessionId: string;
  deviceId: string;
  ownerSkillId: string;
  startedAt: string;
  device: DeviceRecord;
  sampling: LiveCaptureSamplingConfig;
}

export interface LiveCaptureArtifact {
  sourceName?: string;
  formatHint?: string;
  mediaType?: string;
  capturedAt?: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface LiveCaptureArtifactSummary {
  sourceName: string | null;
  formatHint: string | null;
  mediaType: string | null;
  capturedAt: string | null;
  byteLength: number | null;
  textLength: number | null;
  hasText: boolean;
}

export interface LiveCaptureRunnerOutputSummary {
  kind: "empty" | "text" | "bytes";
  byteLength: number;
  textLength: number | null;
  preview: string | null;
  truncated: boolean;
}

export interface LiveCaptureFailureDiagnostics {
  phase: LiveCaptureFailurePhase;
  providerKind: InventoryProviderKind | null;
  backendKind: InventoryBackendKind | null;
  executablePath: string | null;
  command: readonly string[];
  timeoutMs: number | null;
  exitCode: number | null;
  signal: string | null;
  stdout: LiveCaptureRunnerOutputSummary | null;
  stderr: LiveCaptureRunnerOutputSummary | null;
  details: readonly string[];
  diagnostics: readonly InventoryDiagnostic[];
}

export interface LiveCaptureRequest {
  session: LiveCaptureSession;
  requestedAt: string;
  timeoutMs?: number;
}

export interface LiveCaptureSuccess {
  ok: true;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  session: LiveCaptureSession;
  requestedAt: string;
  artifact: LiveCaptureArtifact;
  artifactSummary: LiveCaptureArtifactSummary;
}

export interface LiveCaptureFailure {
  ok: false;
  reason: "capture-failed";
  kind: LiveCaptureFailureKind;
  message: string;
  session: LiveCaptureSession;
  requestedAt: string;
  artifactSummary: LiveCaptureArtifactSummary | null;
  diagnostics: LiveCaptureFailureDiagnostics;
}

export type LiveCaptureResult = LiveCaptureSuccess | LiveCaptureFailure;

export interface ResourceManager {
  refreshInventory(): Promise<readonly DeviceRecord[]>;
  listDevices(): Promise<readonly DeviceRecord[]>;
  allocateDevice(request: AllocationRequest): Promise<AllocationResult>;
  releaseDevice(request: ReleaseRequest): Promise<ReleaseResult>;
  liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult>;
}

export interface InventorySnapshotReporter {
  refreshInventorySnapshot(): Promise<InventorySnapshot>;
  getInventorySnapshot(): Promise<InventorySnapshot>;
}

export type SnapshotResourceManager = ResourceManager & InventorySnapshotReporter;

export const summarizeLiveCaptureArtifact = (
  artifact: LiveCaptureArtifact
): LiveCaptureArtifactSummary => ({
  sourceName: artifact.sourceName ?? null,
  formatHint: artifact.formatHint ?? null,
  mediaType: artifact.mediaType ?? null,
  capturedAt: artifact.capturedAt ?? null,
  byteLength: artifact.bytes?.byteLength ?? null,
  textLength: typeof artifact.text === "string" ? artifact.text.length : null,
  hasText: typeof artifact.text === "string"
});
