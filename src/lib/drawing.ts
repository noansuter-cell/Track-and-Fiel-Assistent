import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./types";

/** Body skeleton connections (BlazePose indices), face mesh edges left out. */
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Torso
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  // Arms
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  // Legs
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  // Feet
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
];

const POINT_INDICES: readonly number[] = [
  LM.NOSE,
  LM.LEFT_EAR,
  LM.RIGHT_EAR,
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
  LM.LEFT_HEEL,
  LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX,
  LM.RIGHT_FOOT_INDEX,
];

const MIN_VISIBILITY = 0.5;

function isDrawable(lm: NormalizedLandmark | undefined): lm is NormalizedLandmark {
  if (!lm) return false;
  return lm.visibility === undefined || lm.visibility >= MIN_VISIBILITY;
}

/** A colored, tappable marker on top of a landmark (scored joint). */
export interface JointMarker {
  landmarkIndex: number;
  color: string;
  selected: boolean;
}

/** Draw the skeleton for one frame. Canvas pixel size must match the video frame size. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[] | null,
  markers: JointMarker[] = [],
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  // Scale line/point size with video resolution so the overlay stays readable.
  const scale = Math.max(width, height) / 640;

  ctx.lineWidth = 2.5 * scale;
  ctx.strokeStyle = "rgba(240, 244, 255, 0.85)";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [from, to] of CONNECTIONS) {
    const a = landmarks[from];
    const b = landmarks[to];
    if (!isDrawable(a) || !isDrawable(b)) continue;
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
  }
  ctx.stroke();

  const marked = new Set(markers.map((m) => m.landmarkIndex));
  ctx.fillStyle = "rgba(240, 244, 255, 0.9)";
  for (const idx of POINT_INDICES) {
    if (marked.has(idx)) continue;
    const lm = landmarks[idx];
    if (!isDrawable(lm)) continue;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const marker of markers) {
    const lm = landmarks[marker.landmarkIndex];
    if (!isDrawable(lm)) continue;
    const x = lm.x * width;
    const y = lm.y * height;
    ctx.beginPath();
    ctx.arc(x, y, 6 * scale, 0, Math.PI * 2);
    ctx.fillStyle = marker.color;
    ctx.fill();
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
    if (marker.selected) {
      ctx.beginPath();
      ctx.arc(x, y, 9.5 * scale, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * scale;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
  }
}
