import type {
  CaptureLogicAnalyzerSessionResult,
  EndLogicAnalyzerSessionResult,
  LogicAnalyzerSessionRecord,
  LogicAnalyzerValidationIssue,
  StartLogicAnalyzerSessionResult,
} from "./contracts.js";
import {
  validateCaptureLogicAnalyzerSessionRequest,
  validateEndLogicAnalyzerSessionRequest,
  validateStartLogicAnalyzerSessionRequest,
} from "./contracts.js";
import { loadLogicCapture, type CaptureLoaderOptions } from "./capture-loader.js";
import { evaluateStartSessionConstraints } from "./session-constraints.js";
import type {
  LiveCaptureArtifact,
  LiveCaptureResult,
  SnapshotResourceManager,
} from "@listenai/contracts";

export interface LogicAnalyzerSkill {
  startSession(request: unknown): Promise<StartLogicAnalyzerSessionResult>;
  captureSession(request: unknown): Promise<CaptureLogicAnalyzerSessionResult>;
  endSession(request: unknown): Promise<EndLogicAnalyzerSessionResult>;
}

export interface LogicAnalyzerSkillOptions {
  createSessionId?: () => string;
  captureLoaderOptions?: CaptureLoaderOptions;
}

const buildSessionRecord = (
  sessionId: string,
  device: LogicAnalyzerSessionRecord["device"],
  requestedAt: string,
  ownerSkillId: string,
  sampling: LogicAnalyzerSessionRecord["sampling"],
  analysis: LogicAnalyzerSessionRecord["analysis"],
): LogicAnalyzerSessionRecord => ({
  sessionId,
  deviceId: device.deviceId,
  ownerSkillId,
  startedAt: requestedAt,
  device,
  sampling,
  analysis,
});

const toCaptureArtifactInput = (artifact: LiveCaptureArtifact) => ({
  sourceName: artifact.sourceName,
  formatHint: artifact.formatHint,
  mediaType: artifact.mediaType,
  capturedAt: artifact.capturedAt,
  text: artifact.text,
  bytes: artifact.bytes,
});

const validateLiveCaptureContract = (
  requestSession: LogicAnalyzerSessionRecord,
  result: Extract<LiveCaptureResult, { ok: true }>,
): readonly LogicAnalyzerValidationIssue[] => {
  const issues: LogicAnalyzerValidationIssue[] = [];

  if (result.session.sessionId !== requestSession.sessionId) {
    issues.push({
      path: "capture.session.sessionId",
      code: "invalid-value",
      message: "Live capture response sessionId must match the requested session.",
    });
  }

  if (result.session.deviceId !== requestSession.deviceId) {
    issues.push({
      path: "capture.session.deviceId",
      code: "invalid-value",
      message: "Live capture response deviceId must match the requested session.",
    });
  }

  if (result.session.ownerSkillId !== requestSession.ownerSkillId) {
    issues.push({
      path: "capture.session.ownerSkillId",
      code: "invalid-value",
      message: "Live capture response ownerSkillId must match the requested session.",
    });
  }

  if (result.session.startedAt !== requestSession.startedAt) {
    issues.push({
      path: "capture.session.startedAt",
      code: "invalid-value",
      message: "Live capture response startedAt must match the requested session.",
    });
  }

  if (result.session.device.deviceId !== requestSession.deviceId) {
    issues.push({
      path: "capture.session.device.deviceId",
      code: "invalid-value",
      message: "Live capture response device.deviceId must match the requested session deviceId.",
    });
  }

  const hasText = typeof result.artifact.text === "string" && result.artifact.text.length > 0;
  const hasBytes =
    result.artifact.bytes instanceof Uint8Array && result.artifact.bytes.byteLength > 0;

  if (!hasText && !hasBytes) {
    issues.push({
      path: "capture.artifact",
      code: "required",
      message: "Live capture response must include non-empty artifact text or bytes.",
    });
  }

  return issues;
};

const buildCaptureSessionRecord = (
  requestSession: LogicAnalyzerSessionRecord,
  result: Extract<LiveCaptureResult, { ok: true }>,
): LogicAnalyzerSessionRecord => ({
  ...requestSession,
  startedAt: result.session.startedAt,
  deviceId: result.session.deviceId,
  ownerSkillId: result.session.ownerSkillId,
  device: result.session.device,
  sampling: result.session.sampling,
});

export const createLogicAnalyzerSkill = (
  resourceManager: SnapshotResourceManager,
  options: LogicAnalyzerSkillOptions = {},
): LogicAnalyzerSkill => {
  let generatedSessionCount = 0;
  const createSessionId =
    options.createSessionId ??
    (() => {
      generatedSessionCount += 1;
      return `logic-analyzer-session-${generatedSessionCount}`;
    });

  return {
    async startSession(request: unknown): Promise<StartLogicAnalyzerSessionResult> {
      const validation = validateStartLogicAnalyzerSessionRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid-request",
          issues: validation.issues,
        };
      }

      const snapshot = await resourceManager.refreshInventorySnapshot();
      const device = snapshot.devices.find(
        (candidate) => candidate.deviceId === validation.value.deviceId,
      );
      const admissibility = evaluateStartSessionConstraints({
        request: validation.value,
        snapshot,
        device,
      });

      if (!admissibility.ok) {
        return admissibility;
      }

      const allocation = await resourceManager.allocateDevice({
        deviceId: validation.value.deviceId,
        ownerSkillId: validation.value.ownerSkillId,
        requestedAt: validation.value.requestedAt,
      });

      if (!allocation.ok) {
        return {
          ok: false,
          reason: "allocation-failed",
          allocation,
          inventory: snapshot.devices,
        };
      }

      return {
        ok: true,
        session: buildSessionRecord(
          createSessionId(),
          allocation.device,
          validation.value.requestedAt,
          validation.value.ownerSkillId,
          validation.value.sampling,
          validation.value.analysis,
        ),
      };
    },

    async captureSession(request: unknown): Promise<CaptureLogicAnalyzerSessionResult> {
      const validation = validateCaptureLogicAnalyzerSessionRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid-request",
          issues: validation.issues,
        };
      }

      const liveCapture = await resourceManager.liveCapture({
        session: validation.value.session,
        requestedAt: validation.value.requestedAt,
        timeoutMs: validation.value.timeoutMs,
      });

      if (!liveCapture.ok) {
        return {
          ok: false,
          reason: "capture-runtime-failed",
          session: validation.value.session,
          requestedAt: validation.value.requestedAt,
          captureRuntime: liveCapture,
        };
      }

      const contractIssues = validateLiveCaptureContract(
        validation.value.session,
        liveCapture,
      );
      const capturedSession = buildCaptureSessionRecord(
        validation.value.session,
        liveCapture,
      );

      if (contractIssues.length > 0) {
        return {
          ok: false,
          reason: "malformed-artifact",
          session: capturedSession,
          requestedAt: liveCapture.requestedAt,
          providerKind: liveCapture.providerKind,
          backendKind: liveCapture.backendKind,
          artifactSummary: liveCapture.artifactSummary,
          issues: contractIssues,
        };
      }

      const capture = loadLogicCapture(
        {
          session: capturedSession,
          artifact: toCaptureArtifactInput(liveCapture.artifact),
        },
        options.captureLoaderOptions,
      );

      if (!capture.ok) {
        return {
          ok: false,
          reason: "load-capture-failed",
          session: capturedSession,
          requestedAt: liveCapture.requestedAt,
          providerKind: liveCapture.providerKind,
          backendKind: liveCapture.backendKind,
          artifactSummary: liveCapture.artifactSummary,
          loadCapture: capture,
        };
      }

      return {
        ok: true,
        session: capturedSession,
        requestedAt: liveCapture.requestedAt,
        providerKind: liveCapture.providerKind,
        backendKind: liveCapture.backendKind,
        artifactSummary: liveCapture.artifactSummary,
        capture,
      };
    },

    async endSession(request: unknown): Promise<EndLogicAnalyzerSessionResult> {
      const validation = validateEndLogicAnalyzerSessionRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid-request",
          issues: validation.issues,
        };
      }

      const release = await resourceManager.releaseDevice({
        deviceId: validation.value.deviceId,
        ownerSkillId: validation.value.ownerSkillId,
        releasedAt: validation.value.endedAt,
      });

      if (!release.ok) {
        return {
          ok: false,
          reason: "release-failed",
          release,
        };
      }

      return {
        ok: true,
        device: release.device,
      };
    },
  };
};
