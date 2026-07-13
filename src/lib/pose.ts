import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// WASM runtime (copied from node_modules by scripts/copy-wasm.mjs) and the
// BlazePose model are served by the app itself — no CDN at runtime, everything
// stays on-device.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const WASM_BASE_URL = `${BASE_PATH}/mediapipe/wasm`;
const MODEL_URL = `${BASE_PATH}/models/pose_landmarker_lite.task`;

/**
 * GitHub Pages sends short cache headers (~10 min), so without this the
 * phone re-downloads ~14 MB of model + WASM on almost every visit. The
 * Cache API keeps them permanently; blob URLs feed them to MediaPipe.
 */
const ASSET_CACHE = "trackcoach-assets-v1";

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

async function cachedBlobUrl(url: string): Promise<string> {
  const cache = await caches.open(ASSET_CACHE);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`Download fehlgeschlagen: ${url}`);
    await cache.put(url, response.clone());
  }
  return URL.createObjectURL(await response.blob());
}

async function createLandmarker(): Promise<PoseLandmarker> {
  // Preferred path: assets from the persistent cache.
  try {
    const [wasmLoaderPath, wasmBinaryPath, modelAssetPath] = await Promise.all([
      cachedBlobUrl(`${WASM_BASE_URL}/vision_wasm_internal.js`),
      cachedBlobUrl(`${WASM_BASE_URL}/vision_wasm_internal.wasm`),
      cachedBlobUrl(MODEL_URL),
    ]);
    return await createWithFallback({ wasmLoaderPath, wasmBinaryPath }, modelAssetPath);
  } catch {
    // Cache API unavailable or cached load failed — plain network path.
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    return await createWithFallback(vision, MODEL_URL);
  }
}

interface WasmFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

async function createWithFallback(
  vision: WasmFileset,
  modelAssetPath: string,
): Promise<PoseLandmarker> {
  try {
    return await createWithDelegate(vision, modelAssetPath, "GPU");
  } catch {
    // Some mobile browsers lack usable WebGL for the GPU delegate.
    return await createWithDelegate(vision, modelAssetPath, "CPU");
  }
}

function createWithDelegate(
  vision: WasmFileset,
  modelAssetPath: string,
  delegate: "GPU" | "CPU",
): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
