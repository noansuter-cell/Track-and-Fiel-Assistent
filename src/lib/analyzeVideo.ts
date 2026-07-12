import { getPoseLandmarker } from "./pose";
import type { FramePose, PoseAnalysis } from "./types";

/** Sampling rate for the analysis pass. Scrubbing snaps to these samples. */
export const SAMPLE_FPS = 30;

/** Hard cap so very long videos can't lock up the device (2 min @ 30 fps). */
const MAX_FRAMES = 3600;

export interface AnalyzeProgress {
  done: number;
  total: number;
}

// The landmarker singleton runs in VIDEO mode, which requires timestamps to
// increase monotonically across ALL calls — including across separate videos.
let monotonicTimestampMs = 0;

/**
 * Runs the whole video through the pose landmarker once, frame by frame
 * (seek-based, deterministic), and returns all landmarks as a cache.
 */
export async function analyzeVideo(
  videoUrl: string,
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal,
): Promise<PoseAnalysis> {
  const landmarker = await getPoseLandmarker();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;

  try {
    await waitForEvent(video, "loadedmetadata", signal);
    const durationSec = await resolveDuration(video, signal);

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Video hat keine lesbaren Bilddaten.");
    }

    const total = Math.min(
      Math.max(1, Math.floor(durationSec * SAMPLE_FPS)),
      MAX_FRAMES,
    );
    const frames: FramePose[] = [];

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      const timeSec = Math.min(i / SAMPLE_FPS, Math.max(0, durationSec - 0.001));
      await seekTo(video, timeSec, signal);
      monotonicTimestampMs += 1000 / SAMPLE_FPS;
      const result = landmarker.detectForVideo(video, monotonicTimestampMs);
      frames.push({
        timeSec,
        landmarks: result.landmarks.length > 0 ? result.landmarks[0] : null,
      });
      onProgress({ done: i + 1, total });
    }

    return {
      frames,
      sampleFps: SAMPLE_FPS,
      durationSec,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * MediaRecorder-produced WebM blobs often report duration = Infinity.
 * Seeking far past the end forces the browser to compute the real duration.
 */
export async function resolveDuration(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }
  video.currentTime = Number.MAX_SAFE_INTEGER;
  const deadline = Date.now() + 10_000;
  while (!Number.isFinite(video.duration) || video.duration === 0) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    if (Date.now() > deadline) {
      throw new Error("Videodauer konnte nicht ermittelt werden.");
    }
    await delay(50);
  }
  const duration = video.duration;
  video.currentTime = 0;
  await waitForEvent(video, "seeked", signal).catch(() => undefined);
  return duration;
}

function seekTo(
  video: HTMLVideoElement,
  timeSec: number,
  signal?: AbortSignal,
): Promise<void> {
  if (Math.abs(video.currentTime - timeSec) < 1e-6 && video.readyState >= 2) {
    return Promise.resolve();
  }
  const seeked = waitForEvent(video, "seeked", signal);
  video.currentTime = timeSec;
  return seeked;
}

function waitForEvent(
  target: EventTarget,
  event: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video konnte nicht geladen werden."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Abgebrochen", "AbortError"));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
