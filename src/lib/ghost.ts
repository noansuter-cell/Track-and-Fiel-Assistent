import { landmarksAt } from "./frames";
import { LM, type PoseAnalysis } from "./types";
import type { Metrics } from "./metrics";

/**
 * Ideal-execution ghost skeleton for sprinting.
 *
 * Between two detected ground contacts the stride phase runs 0→1. Canonical
 * side-view key poses (built from textbook sprint technique: thigh near
 * horizontal at knee lift, full hip extension at toe-off, ~90° arms) are
 * interpolated over that phase, scaled to the athlete's body size and pinned
 * to their hip position, so the trainer can compare directly.
 */

export interface GhostSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One leg/arm posture: angles in degrees measured from straight down, positive = forward. */
interface LimbPose {
  thigh: number;
  shank: number;
}

interface KeyPose {
  /** Support leg = the leg whose contact started this stride interval. */
  support: LimbPose;
  swing: LimbPose;
  /** Upper-arm swing angles (forearm stays at ~90° elbow). */
  armSupportSide: number;
  armSwingSide: number;
  /** Torso lean forward, degrees from vertical. */
  lean: number;
}

// Phase 0 = ground contact of the support leg, phase 1 = next contact (other leg).
const KEY_POSES: { phase: number; pose: KeyPose }[] = [
  {
    phase: 0,
    pose: {
      support: { thigh: -8, shank: -4 },
      swing: { thigh: -28, shank: -135 },
      armSupportSide: 32, // opposite arm forward at contact
      armSwingSide: -30,
      lean: 8,
    },
  },
  {
    phase: 0.35,
    pose: {
      support: { thigh: -32, shank: -20 },
      swing: { thigh: 18, shank: -95 },
      armSupportSide: 5,
      armSwingSide: 0,
      lean: 8,
    },
  },
  {
    phase: 0.65,
    pose: {
      support: { thigh: -38, shank: -140 },
      swing: { thigh: 55, shank: -35 }, // high knee, thigh near horizontal
      armSupportSide: -28,
      armSwingSide: 30,
      lean: 8,
    },
  },
  {
    phase: 1,
    pose: {
      support: { thigh: -28, shank: -135 },
      swing: { thigh: -8, shank: -4 }, // reaching for the next contact
      armSupportSide: -30,
      armSwingSide: 32,
      lean: 8,
    },
  },
];

// Segment lengths as fractions of body height (rough anthropometrics).
const THIGH = 0.245;
const SHANK = 0.246;
const TORSO = 0.3;
const HEAD = 0.13;
const UPPER_ARM = 0.172;
const FOREARM = 0.157;
const HIP_HALF_W = 0.02; // slight offset so the two legs don't overlap fully

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpLimb(a: LimbPose, b: LimbPose, t: number): LimbPose {
  return { thigh: lerp(a.thigh, b.thigh, t), shank: lerp(a.shank, b.shank, t) };
}

function poseAtPhase(phase: number): KeyPose {
  const p = Math.min(Math.max(phase, 0), 1);
  let a = KEY_POSES[0];
  let b = KEY_POSES[KEY_POSES.length - 1];
  for (let i = 0; i + 1 < KEY_POSES.length; i++) {
    if (p >= KEY_POSES[i].phase && p <= KEY_POSES[i + 1].phase) {
      a = KEY_POSES[i];
      b = KEY_POSES[i + 1];
      break;
    }
  }
  const t = b.phase === a.phase ? 0 : (p - a.phase) / (b.phase - a.phase);
  return {
    support: lerpLimb(a.pose.support, b.pose.support, t),
    swing: lerpLimb(a.pose.swing, b.pose.swing, t),
    armSupportSide: lerp(a.pose.armSupportSide, b.pose.armSupportSide, t),
    armSwingSide: lerp(a.pose.armSwingSide, b.pose.armSwingSide, t),
    lean: lerp(a.pose.lean, b.pose.lean, t),
  };
}

/**
 * Ghost segments (normalized coordinates) at a moment in time, or null when
 * the moment is outside the detected stride cycle (sprint mode only).
 */
export function ghostSegmentsAt(
  analysis: PoseAnalysis,
  metrics: Metrics,
  timeSec: number,
): GhostSegment[] | null {
  if (metrics.mode !== "sprint" || metrics.contacts.length < 2) return null;
  const contacts = metrics.contacts;
  let intervalIndex = -1;
  for (let i = 0; i + 1 < contacts.length; i++) {
    if (timeSec >= contacts[i].timeSec && timeSec <= contacts[i + 1].timeSec) {
      intervalIndex = i;
      break;
    }
  }
  if (intervalIndex < 0) return null;
  const from = contacts[intervalIndex];
  const to = contacts[intervalIndex + 1];
  const span = to.timeSec - from.timeSec;
  if (span <= 0 || span > 1) return null;
  const phase = (timeSec - from.timeSec) / span;

  // Anchor at the athlete's current hip midpoint, scale from calibration.
  const landmarks = landmarksAt(analysis, timeSec);
  if (!landmarks || !metrics.segmentChainPx) return null;
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  if (!lHip || !rHip) return null;
  const hipX = (lHip.x + rHip.x) / 2;
  const hipY = (lHip.y + rHip.y) / 2;

  const W = analysis.videoWidth;
  const H = analysis.videoHeight;
  const bodyHeightPx = metrics.segmentChainPx / 0.88;
  const dir = metrics.direction;
  const pose = poseAtPhase(phase);

  // Build points in pixel space relative to the hip, then normalize.
  const pt = (dxPx: number, dyPx: number) => ({
    x: hipX + (dxPx * dir) / W,
    y: hipY + dyPx / H,
  });
  const limbPoints = (
    originDxPx: number,
    originDyPx: number,
    limb: LimbPose,
    l1: number,
    l2: number,
  ) => {
    const rad1 = (limb.thigh * Math.PI) / 180;
    const kneeDx = originDxPx + Math.sin(rad1) * l1 * bodyHeightPx;
    const kneeDy = originDyPx + Math.cos(rad1) * l1 * bodyHeightPx;
    const rad2 = (limb.shank * Math.PI) / 180;
    const endDx = kneeDx + Math.sin(rad2) * l2 * bodyHeightPx;
    const endDy = kneeDy + Math.cos(rad2) * l2 * bodyHeightPx;
    return {
      mid: pt(kneeDx, kneeDy),
      end: pt(endDx, endDy),
      origin: pt(originDxPx, originDyPx),
    };
  };

  const leanRad = (pose.lean * Math.PI) / 180;
  const shoulderDx = Math.sin(leanRad) * TORSO * bodyHeightPx;
  const shoulderDy = -Math.cos(leanRad) * TORSO * bodyHeightPx;
  const headDx = shoulderDx + Math.sin(leanRad) * HEAD * bodyHeightPx;
  const headDy = shoulderDy - Math.cos(leanRad) * HEAD * bodyHeightPx;

  const hipOffset = HIP_HALF_W * bodyHeightPx;
  const supportLeg = limbPoints(-hipOffset, 0, pose.support, THIGH, SHANK);
  const swingLeg = limbPoints(hipOffset, 0, pose.swing, THIGH, SHANK);

  // Arms: elbow fixed at ~90°, forearm points forward relative to upper arm.
  const arm = (angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    const elbowDx = shoulderDx + Math.sin(rad) * UPPER_ARM * bodyHeightPx;
    const elbowDy = shoulderDy + Math.cos(rad) * UPPER_ARM * bodyHeightPx;
    const forearmRad = ((angleDeg + 80) * Math.PI) / 180;
    const wristDx = elbowDx + Math.sin(forearmRad) * FOREARM * bodyHeightPx;
    const wristDy = elbowDy + Math.cos(forearmRad) * FOREARM * bodyHeightPx;
    return {
      shoulder: pt(shoulderDx, shoulderDy),
      elbow: pt(elbowDx, elbowDy),
      wrist: pt(wristDx, wristDy),
    };
  };
  const armA = arm(pose.armSupportSide);
  const armB = arm(pose.armSwingSide);

  const hip = pt(0, 0);
  const shoulder = pt(shoulderDx, shoulderDy);
  const head = pt(headDx, headDy);

  const seg = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): GhostSegment => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

  return [
    seg(hip, shoulder),
    seg(shoulder, head),
    seg(supportLeg.origin, supportLeg.mid),
    seg(supportLeg.mid, supportLeg.end),
    seg(swingLeg.origin, swingLeg.mid),
    seg(swingLeg.mid, swingLeg.end),
    seg(armA.shoulder, armA.elbow),
    seg(armA.elbow, armA.wrist),
    seg(armB.shoulder, armB.elbow),
    seg(armB.elbow, armB.wrist),
  ];
}
