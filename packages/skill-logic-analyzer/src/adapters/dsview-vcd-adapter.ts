import type {
  CaptureAdapterLoadResult,
  CaptureArtifactInput,
  LogicCapture,
  LogicCaptureAdapter,
  LogicCaptureChannel,
  LogicLevel,
} from "../capture-contracts.js";
import {
  readArtifactText,
  summarizeCaptureArtifact,
} from "../capture-contracts.js";

interface ParsedVar {
  id: string;
  channelId: string;
}

interface ParsedTransition {
  timeNs: number;
  fromLevel: LogicLevel;
  toLevel: LogicLevel;
}

interface ParsedCaptureData {
  channelIds: readonly string[];
  initialLevels: ReadonlyMap<string, LogicLevel>;
  transitions: ReadonlyMap<string, readonly ParsedTransition[]>;
  observedTimesNs: readonly number[];
  startTimeNs: number;
  endTimeNs: number;
  timescaleNs: number;
}

const SUPPORTED_TIMESCALE_UNITS = new Map<string, number>([
  ["s", 1_000_000_000],
  ["ms", 1_000_000],
  ["us", 1_000],
  ["ns", 1],
  ["ps", 0.001],
  ["fs", 0.000001],
]);
const SCALAR_LEVEL_MAP = new Map<string, LogicLevel>([
  ["0", 0],
  ["1", 1],
]);
const FORMAT_HINTS = ["dsview-vcd", "vcd", "value-change-dump"] as const;

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const buildUnreadableFailure = (
  input: CaptureArtifactInput,
  message: string,
  details: readonly string[] = [],
): CaptureAdapterLoadResult => ({
  ok: false,
  reason: "unreadable-input",
  adapterId: "dsview-vcd",
  artifact: summarizeCaptureArtifact(input),
  message,
  details,
});

const parseTimescale = (
  value: string,
  input: CaptureArtifactInput,
): number | CaptureAdapterLoadResult => {
  const match = value.match(/^(1|10|100)\s*([a-zA-Z]+)$/);
  if (!match) {
    return buildUnreadableFailure(
      input,
      "VCD timescale must use a supported multiplier and unit.",
      [`Received ${JSON.stringify(value)}.`],
    );
  }

  const multiplier = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const factorNs = SUPPORTED_TIMESCALE_UNITS.get(unit);
  if (factorNs === undefined) {
    return buildUnreadableFailure(input, "VCD timescale unit is not supported.", [
      `Supported units are ${Array.from(SUPPORTED_TIMESCALE_UNITS.keys()).join(", ")}; received ${unit}.`,
    ]);
  }

  return multiplier * factorNs;
};

const parseVarDefinition = (
  line: string,
  input: CaptureArtifactInput,
): ParsedVar | CaptureAdapterLoadResult | null => {
  const match = line.match(/^\$var\s+\S+\s+(\d+)\s+(\S+)\s+(.+?)\s+\$end$/);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  if (width !== 1) {
    return buildUnreadableFailure(input, "VCD adapter only supports single-bit channels.", [
      `Variable ${JSON.stringify(match[3])} uses width ${width}.`,
    ]);
  }

  return {
    id: match[2] ?? "",
    channelId: (match[3] ?? "").trim(),
  };
};

const inferSamplePeriodNs = (
  observedTimesNs: readonly number[],
  timescaleNs: number,
  input: CaptureArtifactInput,
): number | CaptureAdapterLoadResult => {
  if (observedTimesNs.length < 2) {
    return buildUnreadableFailure(
      input,
      "VCD capture must contain at least two timestamped samples.",
      ["A normalized capture needs two or more sample timestamps to infer sample timing."],
    );
  }

  const deltas = observedTimesNs.slice(1).map((timeNs, index) => timeNs - observedTimesNs[index]!);
  if (deltas.some((delta) => !(delta > 0))) {
    return buildUnreadableFailure(input, "VCD timestamps must increase monotonically.", [
      "At least one timestamp did not advance beyond the previous sample.",
    ]);
  }

  const averageDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  const tolerance = Math.max(averageDelta * 0.01, timescaleNs);
  for (const [index, delta] of deltas.entries()) {
    if (Math.abs(delta - averageDelta) > tolerance) {
      return buildUnreadableFailure(
        input,
        "VCD sample timing must stay close to a stable period.",
        [
          `Timestamps ${index} and ${index + 1} differ by ${delta}ns instead of about ${averageDelta}ns.`,
        ],
      );
    }
  }

  return averageDelta;
};

const parseVcdCapture = (
  input: CaptureArtifactInput,
): ParsedCaptureData | CaptureAdapterLoadResult => {
  const text = readArtifactText(input);
  if (!text) {
    return buildUnreadableFailure(input, "Capture artifact does not contain readable text.", [
      "Provide VCD text directly or UTF-8 bytes for the dsview-vcd adapter.",
    ]);
  }

  const lines = splitLines(text);
  if (lines.length === 0) {
    return buildUnreadableFailure(input, "VCD capture is empty.");
  }

  const vars: ParsedVar[] = [];
  let timescaleNs: number | null = null;
  let pendingTimescale: string[] | null = null;
  let sawEndDefinitions = false;
  let currentTimeNs: number | null = null;
  const currentLevels = new Map<string, LogicLevel>();
  const initialLevels = new Map<string, LogicLevel>();
  const transitions = new Map<string, ParsedTransition[]>();
  const observedTimesNs: number[] = [];

  const observeTime = (timeNs: number) => {
    if (observedTimesNs[observedTimesNs.length - 1] !== timeNs) {
      observedTimesNs.push(timeNs);
    }
  };

  const ensureCurrentTime = () => {
    if (currentTimeNs === null) {
      currentTimeNs = 0;
      observeTime(currentTimeNs);
    }

    return currentTimeNs;
  };

  for (const line of lines) {
    if (!sawEndDefinitions) {
      if (pendingTimescale !== null) {
        if (line === "$end") {
          const parsedTimescale = parseTimescale(pendingTimescale.join(" ").trim(), input);
          if (typeof parsedTimescale !== "number") {
            return parsedTimescale;
          }
          timescaleNs = parsedTimescale;
          pendingTimescale = null;
          continue;
        }

        pendingTimescale.push(line);
        continue;
      }

      if (line.startsWith("$timescale")) {
        const inlineValue = line
          .replace(/^\$timescale\s*/i, "")
          .replace(/\s*\$end$/i, "")
          .trim();
        if (line.endsWith("$end")) {
          const parsedTimescale = parseTimescale(inlineValue, input);
          if (typeof parsedTimescale !== "number") {
            return parsedTimescale;
          }
          timescaleNs = parsedTimescale;
        } else {
          pendingTimescale = inlineValue.length > 0 ? [inlineValue] : [];
        }
        continue;
      }

      const parsedVar = parseVarDefinition(line, input);
      if (parsedVar && typeof parsedVar === "object" && "ok" in parsedVar) {
        return parsedVar;
      }
      if (parsedVar) {
        vars.push(parsedVar);
        transitions.set(parsedVar.id, []);
        continue;
      }

      if (line === "$enddefinitions $end") {
        sawEndDefinitions = true;
        continue;
      }

      continue;
    }

    if (line.startsWith("#")) {
      const ticks = Number(line.slice(1));
      if (!Number.isFinite(ticks) || ticks < 0) {
        return buildUnreadableFailure(input, "VCD timestamp must be a non-negative integer.", [
          `Received ${JSON.stringify(line)}.`,
        ]);
      }

      currentTimeNs = ticks * (timescaleNs ?? 1);
      observeTime(currentTimeNs);
      continue;
    }

    if (line.startsWith("$")) {
      continue;
    }

    const scalarMatch = line.match(/^([01xXzZ])(.+)$/);
    if (!scalarMatch) {
      return buildUnreadableFailure(input, "VCD adapter only supports scalar logic value changes.", [
        `Received ${JSON.stringify(line)}.`,
      ]);
    }

    const levelToken = (scalarMatch[1] ?? "").toLowerCase();
    const level = SCALAR_LEVEL_MAP.get(levelToken);
    if (level === undefined) {
      return buildUnreadableFailure(input, "VCD adapter only accepts binary 0/1 logic levels.", [
        `Received ${JSON.stringify(levelToken)} for ${JSON.stringify(scalarMatch[2]?.trim() ?? "")}.`,
      ]);
    }

    const id = (scalarMatch[2] ?? "").trim();
    if (!transitions.has(id)) {
      continue;
    }

    const timeNs = ensureCurrentTime();
    const previousLevel = currentLevels.get(id);
    if (previousLevel === undefined) {
      currentLevels.set(id, level);
      initialLevels.set(id, level);
      continue;
    }

    if (previousLevel === level) {
      continue;
    }

    transitions.get(id)!.push({
      timeNs,
      fromLevel: previousLevel,
      toLevel: level,
    });
    currentLevels.set(id, level);
  }

  if (pendingTimescale !== null || timescaleNs === null) {
    return buildUnreadableFailure(input, "VCD capture must declare a timescale before samples.");
  }

  if (!sawEndDefinitions) {
    return buildUnreadableFailure(input, "VCD capture is missing $enddefinitions.");
  }

  if (vars.length === 0) {
    return buildUnreadableFailure(input, "VCD capture must declare at least one single-bit channel.");
  }

  const missingChannels = vars
    .filter((entry) => !currentLevels.has(entry.id))
    .map((entry) => entry.channelId);
  if (missingChannels.length > 0) {
    return buildUnreadableFailure(
      input,
      "VCD capture is missing initial values for one or more channels.",
      [`Channels without initial values: ${missingChannels.join(", ")}.`],
    );
  }

  if (observedTimesNs.length === 0) {
    observeTime(0);
  }

  return {
    channelIds: vars.map((entry) => entry.channelId),
    initialLevels: new Map(
      vars.map((entry) => [entry.channelId, initialLevels.get(entry.id) ?? 0] as const),
    ),
    transitions: new Map(
      vars.map((entry) => [entry.channelId, transitions.get(entry.id) ?? []] as const),
    ),
    observedTimesNs,
    startTimeNs: observedTimesNs[0] ?? 0,
    endTimeNs: observedTimesNs[observedTimesNs.length - 1] ?? observedTimesNs[0] ?? 0,
    timescaleNs: timescaleNs ?? 1,
  };
};

const buildChannelTransitions = (
  samplePeriodNs: number,
  totalSamples: number,
  startTimeNs: number,
  transitions: readonly ParsedTransition[],
): LogicCaptureChannel["transitions"] =>
  transitions.map((transition) => {
    const relativeTimeNs = Math.max(0, transition.timeNs - startTimeNs);
    const sampleIndex = Math.max(
      0,
      Math.min(
        Math.max(totalSamples - 1, 0),
        Math.round(relativeTimeNs / samplePeriodNs),
      ),
    );

    return {
      sampleIndex,
      timeNs: relativeTimeNs,
      fromLevel: transition.fromLevel,
      toLevel: transition.toLevel,
    };
  });

const buildChannels = (
  channelIds: readonly string[],
  initialLevels: ReadonlyMap<string, LogicLevel>,
  transitions: ReadonlyMap<string, readonly ParsedTransition[]>,
  samplePeriodNs: number,
  totalSamples: number,
  startTimeNs: number,
): LogicCaptureChannel[] =>
  channelIds.map((channelId) => ({
    channelId,
    initialLevel: initialLevels.get(channelId) ?? 0,
    transitions: buildChannelTransitions(
      samplePeriodNs,
      totalSamples,
      startTimeNs,
      transitions.get(channelId) ?? [],
    ),
  }));

const normalizeCapture = (
  input: CaptureArtifactInput,
  parsed: ParsedCaptureData,
): LogicCapture | CaptureAdapterLoadResult => {
  const metadataSampleRateHz = input.sampling?.sampleRateHz;
  let samplePeriodNs: number;
  let totalSamples: number;

  if (typeof metadataSampleRateHz === "number" && metadataSampleRateHz > 0) {
    samplePeriodNs = 1_000_000_000 / metadataSampleRateHz;
    const metadataTotalSamples = input.sampling?.totalSamples;
    if (typeof metadataTotalSamples === "number" && metadataTotalSamples > 0) {
      totalSamples = metadataTotalSamples;
    } else {
      const relativeEndTimeNs = Math.max(0, parsed.endTimeNs - parsed.startTimeNs);
      totalSamples = Math.max(1, Math.round(relativeEndTimeNs / samplePeriodNs) + 1);
    }
  } else {
    const inferredSamplePeriodNs = inferSamplePeriodNs(
      parsed.observedTimesNs,
      parsed.timescaleNs,
      input,
    );
    if (typeof inferredSamplePeriodNs !== "number") {
      return inferredSamplePeriodNs;
    }
    samplePeriodNs = inferredSamplePeriodNs;
    totalSamples = parsed.observedTimesNs.length;
  }

  return {
    adapterId: "dsview-vcd",
    sourceName: input.sourceName ?? null,
    capturedAt: input.capturedAt ?? null,
    sampleRateHz: 1_000_000_000 / samplePeriodNs,
    samplePeriodNs,
    totalSamples,
    durationNs: totalSamples * samplePeriodNs,
    channels: buildChannels(
      parsed.channelIds,
      parsed.initialLevels,
      parsed.transitions,
      samplePeriodNs,
      totalSamples,
      parsed.startTimeNs,
    ),
    artifact: summarizeCaptureArtifact(input),
  };
};

export const dsviewVcdAdapter: LogicCaptureAdapter = {
  id: "dsview-vcd",
  formatHints: FORMAT_HINTS,

  canLoad(input: CaptureArtifactInput): boolean {
    if (typeof input.formatHint === "string") {
      const hint = input.formatHint.trim().toLowerCase();
      if (this.formatHints.includes(hint)) {
        return true;
      }
    }

    if (
      typeof input.sourceName === "string" &&
      input.sourceName.toLowerCase().endsWith(".vcd")
    ) {
      return true;
    }

    const text = readArtifactText(input);
    if (!text) {
      return false;
    }

    return (
      text.includes("$timescale") &&
      text.includes("$enddefinitions") &&
      text.includes("$var")
    );
  },

  load(input: CaptureArtifactInput): CaptureAdapterLoadResult {
    const parsed = parseVcdCapture(input);
    if ("ok" in parsed) {
      return parsed;
    }

    const capture = normalizeCapture(input, parsed);
    if ("ok" in capture) {
      return capture;
    }

    return {
      ok: true,
      capture,
    };
  },
};
