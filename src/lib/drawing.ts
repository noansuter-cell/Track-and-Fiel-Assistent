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

/** Measuring tape between two points (normalized coords) with a label. */
export interface TapeMeasure {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/** Draw a yellow measuring tape with end ticks and a centered label. */
export function drawTape(ctx: CanvasRenderingContext2D, tape: TapeMeasure): void {
  const { width, height } = ctx.canvas;
  const scale = Math.max(width, height) / 640;
  const x1 = tape.x1 * width;
  const y1 = tape.y1 * height;
  const x2 = tape.x2 * width;
  const y2 = tape.y2 * height;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  // Perpendicular unit vector for the end ticks.
  const px = -dy / len;
  const py = dx / len;
  const tick = 8 * scale;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 3.5 * scale;
  ctx.setLineDash([10 * scale, 6 * scale]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1 - px * tick, y1 - py * tick);
  ctx.lineTo(x1 + px * tick, y1 + py * tick);
  ctx.moveTo(x2 - px * tick, y2 - py * tick);
  ctx.lineTo(x2 + px * tick, y2 + py * tick);
  ctx.stroke();

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  ctx.font = `bold ${14 * scale}px system-ui, sans-serif`;
  const metrics = ctx.measureText(tape.label);
  const padX = 8 * scale;
  const padY = 6 * scale;
  const boxW = metrics.width + padX * 2;
  const boxH = 14 * scale + padY * 2;
  ctx.fillStyle = "rgba(17, 19, 24, 0.85)";
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH - 10 * scale, boxW, boxH, 6 * scale);
  ctx.fill();
  ctx.fillStyle = "#facc15";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tape.label, cx, cy - boxH / 2 - 10 * scale);
  ctx.restore();
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
