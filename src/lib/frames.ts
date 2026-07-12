import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { PoseAnalysis } from "./types";

/** Don't interpolate across gaps larger than this (detection dropouts). */
const MAX_INTERPOLATION_GAP_SEC = 0.3;

/** Index of the cached frame closest in time (frames may be unevenly spaced). */
export function nearestFrameIndex(analysis: PoseAnalysis, timeSec: number): number {
  const frames = analysis.frames;
  if (frames.length === 0) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timeSec < timeSec) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && timeSec - frames[lo - 1].timeSec < frames[lo].timeSec - timeSec) {
    return lo - 1;
  }
  return lo;
}

/**
 * Landmarks at an arbitrary time, linearly interpolated between the two
 * neighboring cached frames so the overlay moves smoothly even when the
 * analysis sampled fewer frames than the display refresh rate.
 */
export function landmarksAt(
  analysis: PoseAnalysis,
  timeSec: number,
): NormalizedLandmark[] | null {
  const frames = analysis.frames;
  if (frames.length === 0) return null;

  const idx = nearestFrameIndex(analysis, timeSec);
  const prev = frames[idx].timeSec <= timeSec ? idx : idx - 1;
  const next = prev + 1;

  const a = prev >= 0 ? frames[prev] : null;
  const b = next < frames.length ? frames[next] : null;

  if (a?.landmarks && b?.landmarks) {
    const gap = b.timeSec - a.timeSec;
    if (gap > 0 && gap <= MAX_INTERPOLATION_GAP_SEC) {
      const t = Math.min(1, Math.max(0, (timeSec - a.timeSec) / gap));
      return a.landmarks.map((la, i) => {
        const lb = b.landmarks![i];
        return {
          x: la.x + (lb.x - la.x) * t,
          y: la.y + (lb.y - la.y) * t,
          z: la.z + (lb.z - la.z) * t,
          visibility:
            la.visibility !== undefined && lb.visibility !== undefined
              ? Math.min(la.visibility, lb.visibility)
              : la.visibility,
        };
      });
    }
  }
  return frames[idx].landmarks;
}
