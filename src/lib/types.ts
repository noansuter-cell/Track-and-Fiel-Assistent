import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Pose result for a single sampled video frame. */
export interface FramePose {
  timeSec: number;
  /** 33 BlazePose landmarks in normalized image coordinates, or null if no pose was detected. */
  landmarks: NormalizedLandmark[] | null;
}

/** Full cached analysis of a video, produced once and reused while scrubbing. */
export interface PoseAnalysis {
  frames: FramePose[];
  /** Effective average frames per second of the analysis (frames may be unevenly spaced). */
  sampleFps: number;
  durationSec: number;
  videoWidth: number;
  videoHeight: number;
}

/** BlazePose landmark indices used across the app. */
export const LM = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;
