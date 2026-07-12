import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { angleDeg } from "./geometry";
import { LM, type PoseAnalysis } from "./types";

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

export interface SprintEvent {
  frameIndex: number;
  timeSec: number;
  kind: "contact" | "kneelift";
  label: string;
}

export interface SprintMetrics {
  /** Parallel to analysis.frames. */
  perFrame: FrameAssessments[];
  /** Key moments (ground contacts, knee-lift peaks) for timeline chips. */
  events: SprintEvent[];
  cadenceStepsPerSec: number | null;
  meanTorsoLeanDeg: number | null;
}

export function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e"; // green
  if (score >= 60) return "#eab308"; // yellow
  if (score >= 40) return "#f97316"; // orange
  return "#ef4444"; // red
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

/** Elevation of the thigh: 0° = hanging straight down, 90° = horizontal. */
function thighElevationDeg(hip: NormalizedLandmark, knee: NormalizedLandmark): number {
  const vx = knee.x - hip.x;
  const vy = knee.y - hip.y; // y grows downwards
  const len = Math.hypot(vx, vy);
  if (len === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, vy / len))) * 180) / Math.PI;
}

export function computeSprintMetrics(analysis: PoseAnalysis): SprintMetrics {
  const frames = analysis.frames;
  const n = frames.length;
  const times = frames.map((f) => f.timeSec);

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

  // Precompute per-frame raw series used by windowed scores.
  const thighElev: { left: (number | null)[]; right: (number | null)[] } = {
    left: [],
    right: [],
  };
  const hipAngle: { left: (number | null)[]; right: (number | null)[] } = {
    left: [],
    right: [],
  };
  const noseY: (number | null)[] = [];
  const torsoLen: (number | null)[] = [];
  const ankleY: { left: (number | null)[]; right: (number | null)[] } = {
    left: [],
    right: [],
  };

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

    if (lm && vis(lm[LM.NOSE])) noseY.push(lm[LM.NOSE].y);
    else noseY.push(null);
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
    } else {
      torsoLen.push(null);
    }
    ankleY.left.push(lm && vis(lm[LM.LEFT_ANKLE]) ? lm[LM.LEFT_ANKLE].y : null);
    ankleY.right.push(lm && vis(lm[LM.RIGHT_ANKLE]) ? lm[LM.RIGHT_ANKLE].y : null);
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

  // --- Per-frame assessments ---
  const perFrame: FrameAssessments[] = [];
  const leanSamples: number[] = [];

  for (let i = 0; i < n; i++) {
    const lm = frames[i].landmarks;
    const a: FrameAssessments = {};
    if (!lm) {
      perFrame.push(a);
      continue;
    }

    // Arm carriage: elbow angle, target ~90° (60–110° fine).
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

    // Knee lift: best thigh elevation reached around this moment.
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

    // Hip extension at push-off: best hip opening around this moment.
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

    // Torso lean relative to vertical, in running direction (5–15° ideal).
    if (
      vis(lm[LM.LEFT_SHOULDER]) &&
      vis(lm[LM.RIGHT_SHOULDER]) &&
      vis(lm[LM.LEFT_HIP]) &&
      vis(lm[LM.RIGHT_HIP])
    ) {
      const s = mid(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
      const h = mid(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
      const lean =
        (Math.atan2((s.x - h.x) * direction, h.y - s.y) * 180) / Math.PI;
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

    // Head stability: rolling deviation of the nose relative to torso length.
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
        const sd = Math.sqrt(
          win.reduce((x, y) => x + (y - mean) ** 2, 0) / win.length,
        );
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
  const contacts: SprintEvent[] = [];
  for (const [side, series] of [
    ["links", ankleY.left],
    ["rechts", ankleY.right],
  ] as const) {
    const valid = series
      .map((y, i) => ({ y, i }))
      .filter((p): p is { y: number; i: number } => p.y !== null);
    if (valid.length < 5) continue;
    const ys = valid.map((p) => p.y);
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    const threshold = maxY - (maxY - minY) * 0.15;
    let lastT = -Infinity;
    for (let k = 1; k < valid.length - 1; k++) {
      const { y, i } = valid[k];
      if (y < threshold) continue;
      if (y < valid[k - 1].y || y < valid[k + 1].y) continue;
      if (times[i] - lastT < 0.18) continue;
      lastT = times[i];
      contacts.push({
        frameIndex: i,
        timeSec: times[i],
        kind: "contact",
        label: `Kontakt ${side}`,
      });
    }
  }
  contacts.sort((a, b) => a.timeSec - b.timeSec);

  // Knee-lift peaks between consecutive contacts.
  const kneelifts: SprintEvent[] = [];
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
      kneelifts.push({
        frameIndex: bestI,
        timeSec: times[bestI],
        kind: "kneelift",
        label: "Kniehub",
      });
    }
  }

  const events = [...contacts, ...kneelifts]
    .sort((a, b) => a.timeSec - b.timeSec)
    .slice(0, 12);

  const cadenceStepsPerSec =
    contacts.length >= 3
      ? (contacts.length - 1) /
        (contacts[contacts.length - 1].timeSec - contacts[0].timeSec)
      : null;

  const meanTorsoLeanDeg =
    leanSamples.length > 0
      ? leanSamples.reduce((x, y) => x + y, 0) / leanSamples.length
      : null;

  return { perFrame, events, cadenceStepsPerSec, meanTorsoLeanDeg };
}
