import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { angleDeg } from "./geometry";
import { LM, type PoseAnalysis } from "./types";

export type Mode = "sprint" | "weitsprung";

export const MODE_LABELS: Record<Mode, string> = {
  sprint: "Sprint",
  weitsprung: "Weitsprung",
};

/** Joints that get a per-frame score and are tappable in the UI. */
export type ScoredJoint =
  | "leftElbow"
  | "rightElbow"
  | "leftKnee"
  | "rightKnee"
  | "leftHip"
  | "rightHip"
  | "torso"
  | "head";

/** Landmark indices a joint's colored marker is drawn on. */
export const JOINT_MARKER_LANDMARKS: Record<ScoredJoint, number[]> = {
  leftElbow: [LM.LEFT_ELBOW],
  rightElbow: [LM.RIGHT_ELBOW],
  leftKnee: [LM.LEFT_KNEE],
  rightKnee: [LM.RIGHT_KNEE],
  leftHip: [LM.LEFT_HIP],
  rightHip: [LM.RIGHT_HIP],
  torso: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  head: [LM.NOSE],
};

export const JOINT_LABELS: Record<ScoredJoint, string> = {
  leftElbow: "Ellbogen links",
  rightElbow: "Ellbogen rechts",
  leftKnee: "Kniehub links",
  rightKnee: "Kniehub rechts",
  leftHip: "Hüftstreckung links",
  rightHip: "Hüftstreckung rechts",
  torso: "Oberkörper-Vorlage",
  head: "Kopfstabilität",
};

export interface JointAssessment {
  /** 0–100, drives the marker color. */
  score: number;
  /** German one-liner shown when the joint is tapped. */
  feedback: string;
}

export type FrameAssessments = Partial<Record<ScoredJoint, JointAssessment>>;

export interface MetricEvent {
  frameIndex: number;
  timeSec: number;
  kind: "contact" | "kneelift" | "takeoff" | "apex" | "landing";
  label: string;
}

/** A measurable step between two alternating ground contacts (normalized coords). */
export interface StepMeasure {
  timeSec: number;
  x1: number;
  x2: number;
  groundY: number;
  lengthPx: number;
}

/** Long-jump specifics (normalized coords for drawing, px for measuring). */
export interface JumpMeasure {
  takeoffIndex: number;
  apexIndex: number;
  landingIndex: number;
  takeoffAngleDeg: number | null;
  apexX: number;
  apexY: number;
  takeoffHipY: number;
  flightHeightPx: number;
}

export interface Metrics {
  mode: Mode;
  /** Parallel to analysis.frames. */
  perFrame: FrameAssessments[];
  events: MetricEvent[];
  steps: StepMeasure[];
  jump: JumpMeasure | null;
  cadenceStepsPerSec: number | null;
  meanTorsoLeanDeg: number | null;
  /**
   * Median length of the nose→shoulder→hip→knee→ankle segment chain in
   * pixels (≈ 88% of body height) — the pixel↔meter calibration anchor.
   */
  segmentChainPx: number | null;
}

/** Meters per pixel given the athlete's height; null without calibration data. */
export function metersPerPixel(
  segmentChainPx: number | null,
  heightCm: number | null,
): number | null {
  if (!segmentChainPx || !heightCm || heightCm < 100 || heightCm > 230) return null;
  return ((heightCm / 100) * 0.88) / segmentChainPx;
}

export function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

const MIN_VIS = 0.5;

function vis(lm: NormalizedLandmark | undefined): lm is NormalizedLandmark {
  if (!lm) return false;
  return lm.visibility === undefined || lm.visibility >= MIN_VIS;
}

function clampScore(s: number): number {
  return Math.max(0, Math.min(100, Math.round(s)));
}

function mid(a: NormalizedLandmark, b: NormalizedLandmark) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Elevation of the thigh: 0° = hanging straight down, 90° = horizontal. */
function thighElevationDeg(hip: NormalizedLandmark, knee: NormalizedLandmark): number {
  const vx = knee.x - hip.x;
  const vy = knee.y - hip.y; // y grows downwards
  const len = Math.hypot(vx, vy);
  if (len === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, vy / len))) * 180) / Math.PI;
}

interface Contact {
  frameIndex: number;
  timeSec: number;
  side: "links" | "rechts";
  ankleX: number;
  ankleY: number;
}

export function computeMetrics(analysis: PoseAnalysis, mode: Mode): Metrics {
  const frames = analysis.frames;
  const n = frames.length;
  const times = frames.map((f) => f.timeSec);
  const W = analysis.videoWidth;
  const H = analysis.videoHeight;
  const pxDist = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);

  // Running direction: sign of horizontal hip movement over the clip.
  let direction = 1;
  {
    const xs: number[] = [];
    for (const f of frames) {
      const lm = f.landmarks;
      if (lm && vis(lm[LM.LEFT_HIP]) && vis(lm[LM.RIGHT_HIP])) {
        xs.push(mid(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]).x);
      }
    }
    if (xs.length >= 2 && Math.abs(xs[xs.length - 1] - xs[0]) > 0.05) {
      direction = xs[xs.length - 1] - xs[0] > 0 ? 1 : -1;
    }
  }

  // --- Per-frame raw series ---
  const thighElev = { left: [] as (number | null)[], right: [] as (number | null)[] };
  const hipAngle = { left: [] as (number | null)[], right: [] as (number | null)[] };
  const noseY: (number | null)[] = [];
  const torsoLen: (number | null)[] = [];
  const ankle = {
    left: [] as ({ x: number; y: number } | null)[],
    right: [] as ({ x: number; y: number } | null)[],
  };
  const hipMidY: (number | null)[] = [];
  const hipMidX: (number | null)[] = [];
  const segChainPxSamples: number[] = [];

  for (const f of frames) {
    const lm = f.landmarks;
    const side = (hip: number, knee: number, shoulder: number) => {
      if (!lm || !vis(lm[hip]) || !vis(lm[knee])) return { elev: null, hip: null };
      const elev = thighElevationDeg(lm[hip], lm[knee]);
      const hipA = vis(lm[shoulder]) ? angleDeg(lm[shoulder], lm[hip], lm[knee]) : null;
      return { elev, hip: hipA !== null && !Number.isNaN(hipA) ? hipA : null };
    };
    const l = side(LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_SHOULDER);
    const r = side(LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_SHOULDER);
    thighElev.left.push(l.elev);
    thighElev.right.push(r.elev);
    hipAngle.left.push(l.hip);
    hipAngle.right.push(r.hip);

    noseY.push(lm && vis(lm[LM.NOSE]) ? lm[LM.NOSE].y : null);
    ankle.left.push(lm && vis(lm[LM.LEFT_ANKLE]) ? { x: lm[LM.LEFT_ANKLE].x, y: lm[LM.LEFT_ANKLE].y } : null);
    ankle.right.push(lm && vis(lm[LM.RIGHT_ANKLE]) ? { x: lm[LM.RIGHT_ANKLE].x, y: lm[LM.RIGHT_ANKLE].y } : null);

    if (
      lm &&
      vis(lm[LM.LEFT_SHOULDER]) &&
      vis(lm[LM.RIGHT_SHOULDER]) &&
      vis(lm[LM.LEFT_HIP]) &&
      vis(lm[LM.RIGHT_HIP])
    ) {
      const s = mid(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
      const h = mid(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
      torsoLen.push(Math.hypot(s.x - h.x, s.y - h.y));
      hipMidY.push(h.y);
      hipMidX.push(h.x);

      // Calibration chain: nose→shoulderMid→hipMid→knee→ankle (side average).
      if (vis(lm[LM.NOSE])) {
        const legs: number[] = [];
        for (const [hipI, kneeI, ankleI] of [
          [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
          [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
        ] as const) {
          if (vis(lm[hipI]) && vis(lm[kneeI]) && vis(lm[ankleI])) {
            legs.push(pxDist(lm[hipI], lm[kneeI]) + pxDist(lm[kneeI], lm[ankleI]));
          }
        }
        if (legs.length > 0) {
          segChainPxSamples.push(
            pxDist(lm[LM.NOSE], s) + pxDist(s, h) + legs.reduce((a, b) => a + b, 0) / legs.length,
          );
        }
      }
    } else {
      torsoLen.push(null);
      hipMidY.push(null);
      hipMidX.push(null);
    }
  }

  const windowedMax = (
    series: (number | null)[],
    i: number,
    windowSec: number,
  ): number | null => {
    let best: number | null = null;
    for (let j = i; j >= 0 && times[i] - times[j] <= windowSec; j--) {
      const v = series[j];
      if (v !== null && (best === null || v > best)) best = v;
    }
    for (let j = i + 1; j < n && times[j] - times[i] <= windowSec; j++) {
      const v = series[j];
      if (v !== null && (best === null || v > best)) best = v;
    }
    return best;
  };

  // --- Per-frame assessments (run technique, applies to both modes) ---
  const perFrame: FrameAssessments[] = [];
  const leanSamples: number[] = [];

  for (let i = 0; i < n; i++) {
    const lm = frames[i].landmarks;
    const a: FrameAssessments = {};
    if (!lm) {
      perFrame.push(a);
      continue;
    }

    for (const [joint, s, e, w] of [
      ["leftElbow", LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
      ["rightElbow", LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
    ] as const) {
      if (vis(lm[s]) && vis(lm[e]) && vis(lm[w])) {
        const ang = angleDeg(lm[s], lm[e], lm[w]);
        if (!Number.isNaN(ang)) {
          const out = Math.max(0, 60 - ang, ang - 110);
          const score = clampScore(100 - out * 2);
          a[joint] = {
            score,
            feedback:
              score >= 80
                ? `Armwinkel ${ang.toFixed(0)}° – im Zielbereich (60–110°).`
                : score >= 60
                  ? `Armwinkel ${ang.toFixed(0)}° – leicht daneben, ~90° anstreben.`
                  : `Armwinkel ${ang.toFixed(0)}° – Arme aktiv auf ~90° beugen und aus der Schulter führen.`,
          };
        }
      }
    }

    for (const [joint, series] of [
      ["leftKnee", thighElev.left],
      ["rightKnee", thighElev.right],
    ] as const) {
      const m = windowedMax(series, i, 0.35);
      if (m !== null) {
        const score = clampScore(100 - Math.max(0, 80 - m) * 1.8);
        a[joint] = {
          score,
          feedback:
            score >= 80
              ? `Kniehub ${m.toFixed(0)}° – Oberschenkel kommt gut Richtung horizontal.`
              : score >= 60
                ? `Kniehub ${m.toFixed(0)}° – ausbaufähig, Knie aktiver nach vorne-oben.`
                : `Kniehub ${m.toFixed(0)}° – zu gering, Oberschenkel Richtung horizontal bringen.`,
        };
      }
    }

    for (const [joint, series] of [
      ["leftHip", hipAngle.left],
      ["rightHip", hipAngle.right],
    ] as const) {
      const h = windowedMax(series, i, 0.3);
      if (h !== null) {
        const score = clampScore(100 - Math.max(0, 165 - h) * 2.5);
        a[joint] = {
          score,
          feedback:
            score >= 80
              ? `Hüftstreckung ${h.toFixed(0)}° – voll gestreckt beim Abdruck.`
              : score >= 60
                ? `Hüftstreckung ${h.toFixed(0)}° – nicht ganz vollständig, aktiver abdrücken.`
                : `Hüftstreckung ${h.toFixed(0)}° – „sitzende" Position, Hüfte beim Abdruck komplett öffnen.`,
        };
      }
    }

    if (torsoLen[i] !== null && hipMidY[i] !== null) {
      const lm2 = lm;
      const s = mid(lm2[LM.LEFT_SHOULDER], lm2[LM.RIGHT_SHOULDER]);
      const h = mid(lm2[LM.LEFT_HIP], lm2[LM.RIGHT_HIP]);
      const lean = (Math.atan2((s.x - h.x) * direction, h.y - s.y) * 180) / Math.PI;
      leanSamples.push(lean);
      const dist = lean < 5 ? 5 - lean : lean > 15 ? lean - 15 : 0;
      const score = clampScore(100 - dist * 4);
      a.torso = {
        score,
        feedback:
          score >= 80
            ? `Vorlage ${lean.toFixed(0)}° – ruhiger Oberkörper mit guter Sprintvorlage.`
            : lean < 5
              ? `Vorlage ${lean.toFixed(0)}° – zu aufrecht, leicht nach vorne lehnen (5–15°).`
              : `Vorlage ${lean.toFixed(0)}° – zu stark geneigt, Oberkörper aufrichten (5–15°).`,
      };
    }

    {
      const win: number[] = [];
      for (let j = 0; j < n; j++) {
        if (Math.abs(times[j] - times[i]) <= 0.5 && noseY[j] !== null) {
          win.push(noseY[j] as number);
        }
      }
      const tl = torsoLen[i];
      if (win.length >= 4 && tl) {
        const mean = win.reduce((x, y) => x + y, 0) / win.length;
        const sd = Math.sqrt(win.reduce((x, y) => x + (y - mean) ** 2, 0) / win.length);
        const ratio = sd / tl;
        const score = clampScore(100 - Math.max(0, ratio - 0.05) * 500);
        a.head = {
          score,
          feedback:
            score >= 80
              ? "Kopf ruhig – Blick stabil nach vorne."
              : score >= 60
                ? "Kopf leicht unruhig – Blick auf einen festen Punkt richten."
                : "Kopf schwankt stark – Kopf ruhig halten, Blick nach vorne fixieren.",
        };
      }
    }

    perFrame.push(a);
  }

  // --- Ground contacts: local maxima of ankle Y (image Y grows downwards). ---
  const contacts: Contact[] = [];
  for (const [side, series] of [
    ["links", ankle.left],
    ["rechts", ankle.right],
  ] as const) {
    const valid = series
      .map((p, i) => ({ p, i }))
      .filter((e): e is { p: { x: number; y: number }; i: number } => e.p !== null);
    if (valid.length < 5) continue;
    const ys = valid.map((e) => e.p.y);
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    const threshold = maxY - (maxY - minY) * 0.15;
    let lastT = -Infinity;
    for (let k = 1; k < valid.length - 1; k++) {
      const { p, i } = valid[k];
      if (p.y < threshold) continue;
      if (p.y < valid[k - 1].p.y || p.y < valid[k + 1].p.y) continue;
      if (times[i] - lastT < 0.18) continue;
      lastT = times[i];
      contacts.push({ frameIndex: i, timeSec: times[i], side, ankleX: p.x, ankleY: p.y });
    }
  }
  contacts.sort((a, b) => a.timeSec - b.timeSec);

  // --- Steps between alternating contacts (for the measuring tape) ---
  const steps: StepMeasure[] = [];
  for (let c = 0; c + 1 < contacts.length; c++) {
    const a = contacts[c];
    const b = contacts[c + 1];
    const dt = b.timeSec - a.timeSec;
    if (a.side === b.side || dt < 0.1 || dt > 0.8) continue;
    const lengthPx = Math.abs(b.ankleX - a.ankleX) * W;
    if (lengthPx < W * 0.02) continue;
    steps.push({
      timeSec: b.timeSec,
      x1: a.ankleX,
      x2: b.ankleX,
      groundY: Math.max(a.ankleY, b.ankleY),
      lengthPx,
    });
  }

  // --- Long jump: the longest airborne gap between contacts ---
  let jump: JumpMeasure | null = null;
  if (mode === "weitsprung" && contacts.length >= 2) {
    let best: { a: Contact; b: Contact; dt: number } | null = null;
    for (let c = 0; c + 1 < contacts.length; c++) {
      const dt = contacts[c + 1].timeSec - contacts[c].timeSec;
      if (!best || dt > best.dt) best = { a: contacts[c], b: contacts[c + 1], dt };
    }
    if (best && best.dt >= 0.3) {
      const from = best.a.frameIndex;
      const to = best.b.frameIndex;
      let apexIndex = -1;
      let apexY = Infinity;
      for (let i = from; i <= to; i++) {
        const y = hipMidY[i];
        if (y !== null && y < apexY) {
          apexY = y;
          apexIndex = i;
        }
      }
      const takeoffHipY = hipMidY[from];
      const apexXVal = apexIndex >= 0 ? hipMidX[apexIndex] : null;
      if (apexIndex >= 0 && takeoffHipY !== null && apexXVal !== null) {
        // Takeoff angle from the hip trajectory shortly after takeoff.
        let takeoffAngleDeg: number | null = null;
        const x0 = hipMidX[from];
        for (let i = from + 1; i < n && times[i] - times[from] <= 0.2; i++) {
          const x1 = hipMidX[i];
          const y1 = hipMidY[i];
          if (x0 !== null && x1 !== null && y1 !== null && Math.abs(x1 - x0) > 0.005) {
            takeoffAngleDeg =
              (Math.atan2((takeoffHipY - y1) * H, Math.abs(x1 - x0) * W) * 180) / Math.PI;
          }
        }
        jump = {
          takeoffIndex: from,
          apexIndex,
          landingIndex: to,
          takeoffAngleDeg,
          apexX: apexXVal,
          apexY,
          takeoffHipY,
          flightHeightPx: (takeoffHipY - apexY) * H,
        };
      }
    }
  }

  // --- Timeline events ---
  const events: MetricEvent[] = contacts.map((c) => ({
    frameIndex: c.frameIndex,
    timeSec: c.timeSec,
    kind: "contact" as const,
    label: `Kontakt ${c.side}`,
  }));

  if (mode === "sprint") {
    for (let c = 0; c + 1 < contacts.length; c++) {
      const from = contacts[c].frameIndex;
      const to = contacts[c + 1].frameIndex;
      let bestI = -1;
      let bestV = -Infinity;
      for (let i = from + 1; i < to; i++) {
        const v = Math.max(thighElev.left[i] ?? -Infinity, thighElev.right[i] ?? -Infinity);
        if (v > bestV) {
          bestV = v;
          bestI = i;
        }
      }
      if (bestI >= 0 && bestV > 30) {
        events.push({
          frameIndex: bestI,
          timeSec: times[bestI],
          kind: "kneelift",
          label: "Kniehub",
        });
      }
    }
  } else if (jump) {
    events.push(
      { frameIndex: jump.takeoffIndex, timeSec: times[jump.takeoffIndex], kind: "takeoff", label: "Absprung" },
      { frameIndex: jump.apexIndex, timeSec: times[jump.apexIndex], kind: "apex", label: "Flugmitte" },
      { frameIndex: jump.landingIndex, timeSec: times[jump.landingIndex], kind: "landing", label: "Landung" },
    );
  }

  const sortedEvents = events.sort((a, b) => a.timeSec - b.timeSec).slice(0, 14);

  const cadenceStepsPerSec =
    contacts.length >= 3
      ? (contacts.length - 1) / (contacts[contacts.length - 1].timeSec - contacts[0].timeSec)
      : null;

  const meanTorsoLeanDeg =
    leanSamples.length > 0
      ? leanSamples.reduce((x, y) => x + y, 0) / leanSamples.length
      : null;

  return {
    mode,
    perFrame,
    events: sortedEvents,
    steps,
    jump,
    cadenceStepsPerSec,
    meanTorsoLeanDeg,
    segmentChainPx: median(segChainPxSamples),
  };
}
