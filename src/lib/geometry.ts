import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./types";

const MIN_VISIBILITY = 0.5;

/**
 * Angle at vertex b (in degrees, 0–180) formed by the segments b→a and b→c,
 * computed in 2D image coordinates.
 */
export function angleDeg(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function visible(lm: NormalizedLandmark): boolean {
  return lm.visibility === undefined || lm.visibility >= MIN_VISIBILITY;
}

/** Knee angle (hip–knee–ankle) for one side, or null if any landmark is unreliable. */
export function kneeAngle(
  landmarks: NormalizedLandmark[],
  side: "left" | "right",
): number | null {
  const [hip, knee, ankle] =
    side === "left"
      ? [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
      : [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];
  const h = landmarks[hip];
  const k = landmarks[knee];
  const a = landmarks[ankle];
  if (!h || !k || !a) return null;
  if (!visible(h) || !visible(k) || !visible(a)) return null;
  const angle = angleDeg(h, k, a);
  return Number.isNaN(angle) ? null : angle;
}

/** Mean visibility of the core body landmarks — a rough detection confidence. */
export function bodyConfidence(landmarks: NormalizedLandmark[]): number | null {
  const core = [
    LM.LEFT_SHOULDER,
    LM.RIGHT_SHOULDER,
    LM.LEFT_HIP,
    LM.RIGHT_HIP,
    LM.LEFT_KNEE,
    LM.RIGHT_KNEE,
    LM.LEFT_ANKLE,
    LM.RIGHT_ANKLE,
  ];
  let sum = 0;
  let count = 0;
  for (const idx of core) {
    const lm = landmarks[idx];
    if (lm?.visibility !== undefined) {
      sum += lm.visibility;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}
