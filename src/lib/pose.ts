import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// WASM runtime (copied from node_modules by scripts/copy-wasm.mjs) and the
// BlazePose model are served by the app itself — no CDN at runtime, everything
// stays on-device.
const WASM_BASE_URL = "/mediapipe/wasm";
const MODEL_URL = "/models/pose_landmarker_lite.task";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((err) => {
      // Allow a retry on the next call instead of caching the failure forever.
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

async function createLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  try {
    return await createWithDelegate(vision, "GPU");
  } catch {
    // Some mobile browsers lack usable WebGL for the GPU delegate.
    return await createWithDelegate(vision, "CPU");
  }
}

function createWithDelegate(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: "GPU" | "CPU",
): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
