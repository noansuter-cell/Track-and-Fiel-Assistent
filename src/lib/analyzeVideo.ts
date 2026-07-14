import { getPoseLandmarker } from "./pose";
import type { FramePose, PoseAnalysis } from "./types";

/** Analyze at most this much video (safety cap for very long clips). */
const MAX_ANALYZED_SECONDS = 120;

/**
 * Frames are downscaled to this long-side size before inference. BlazePose
 * works on a small internal input anyway; feeding 4K frames just wastes time.
 */
const INFERENCE_MAX_SIDE = 640;

/** Sampling step for the seek-based fallback/densify path. */
const FALLBACK_SAMPLE_FPS = 10;

/**
 * If playback capture ends up with fewer samples per second than this
 * (e.g. the tab was throttled), re-analyze seek-based for short clips.
 */
const MIN_ACCEPTABLE_FPS = 4;

/** Seek-based re-analysis is only worth it for clips up to this length. */
const DENSIFY_MAX_SECONDS = 20;

/** Abort if the video produces no new frame for this long during analysis. */
const STALL_TIMEOUT_MS = 20_000;

export interface AnalyzeProgress {
  processedSec: number;
  totalSec: number;
  frames: number;
}

/** Which stage the analysis is in — for honest loading UI. */
export type AnalyzeStatus = "model" | "video" | "analyze";

// The landmarker singleton runs in VIDEO mode, which requires timestamps to
// increase monotonically across ALL calls — including across separate videos.
let monotonicTimestampMs = 0;

/**
 * Runs the whole video through the pose landmarker once and returns all
 * landmarks as a cache.
 *
 * Primary strategy: play the video once (muted) and capture every presented
 * frame via requestVideoFrameCallback — the hardware decoder works
 * sequentially, which is fast even for 4K/HEVC phone videos. Seeking frame by
 * frame instead would force a keyframe re-decode per step and can take
 * minutes on mobile. Analysis time ≈ video duration.
 *
 * The caller provides the video element and must keep it VISIBLE in the DOM:
 * requestVideoFrameCallback only fires for composited (on-screen) videos.
 */
export async function analyzeVideo(
  video: HTMLVideoElement,
  onProgress: (p: AnalyzeProgress) => void,
  signal?: AbortSignal,
  onStatus?: (status: AnalyzeStatus) => void,
): Promise<PoseAnalysis> {
  onStatus?.("model");
  const landmarker = await getPoseLandmarker();
  onStatus?.("video");
  video.muted = true;
  video.playsInline = true;

  try {
    if (video.readyState < 1) {
      await waitForEvent(video, "loadedmetadata", signal, 20_000);
    }
    const durationSec = await resolveDuration(video, signal);

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Video hat keine lesbaren Bilddaten.");
    }
    const totalSec = Math.min(durationSec, MAX_ANALYZED_SECONDS);

    // Downscale frames before inference; landmarks are normalized, so the
    // overlay is unaffected.
    const scale = Math.min(
      1,
      INFERENCE_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas-Kontext nicht verfügbar.");

    let thumbnail: string | null = null;
    const detectFrame = (timeSec: number, frames: FramePose[]) => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (!thumbnail && timeSec >= totalSec * 0.35) {
        thumbnail = captureThumbnail(canvas);
      }
      monotonicTimestampMs += 40;
      const result = landmarker.detectForVideo(canvas, monotonicTimestampMs);
      frames.push({
        timeSec,
        landmarks: result.landmarks.length > 0 ? result.landmarks[0] : null,
      });
      onProgress({ processedSec: timeSec, totalSec, frames: frames.length });
    };

    // Warm up the model before playback starts: the very first inference
    // triggers GPU shader compilation, which can take several seconds on
    // phones — long enough for a short clip to play to its end unanalyzed.
    // A blank canvas is enough (no decoded video data needed — waiting for
    // that can hang forever on iOS in low-power/data-saver situations).
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    monotonicTimestampMs += 40;
    landmarker.detectForVideo(canvas, monotonicTimestampMs);
    const steadyStart = performance.now();
    monotonicTimestampMs += 40;
    landmarker.detectForVideo(canvas, monotonicTimestampMs);
    const steadyMs = performance.now() - steadyStart;
    onStatus?.("analyze");

    let frames: FramePose[];
    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        frames = await captureByPlayback(video, totalSec, steadyMs, detectFrame, signal);
        // Too sparse (throttled tab, very slow device): one extra slow-rate
        // playback pass and merge. Never fall back to per-frame seeking here —
        // seeking re-decodes from the last keyframe and takes minutes on
        // 4K/HEVC phone videos.
        if (
          frames.length < totalSec * MIN_ACCEPTABLE_FPS &&
          totalSec <= DENSIFY_MAX_SECONDS
        ) {
          const extra = await captureByPlayback(
            video,
            totalSec,
            Number.POSITIVE_INFINITY, // force 0.5x rate
            detectFrame,
            signal,
          );
          frames = mergeFrames(frames, extra);
        }
      } catch (err) {
        if (err instanceof PlaybackBlockedError) {
          // e.g. iOS low-power mode refusing muted autoplay
          frames = await captureBySeeking(video, totalSec, detectFrame, signal);
        } else {
          throw err;
        }
      }
    } else {
      frames = await captureBySeeking(video, totalSec, detectFrame, signal);
    }

    if (frames.length === 0) {
      throw new Error("Es konnten keine Frames aus dem Video gelesen werden.");
    }

    return {
      frames,
      sampleFps: frames.length / totalSec,
      durationSec: totalSec,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      thumbnail,
    };
  } finally {
    video.pause();
  }
}

class PlaybackBlockedError extends Error {}

/** Tiny JPEG for history cards (kept small — it lands in localStorage). */
function captureThumbnail(source: HTMLCanvasElement): string | null {
  try {
    const w = 200;
    const h = Math.round((source.height / source.width) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.drawImage(source, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

/** Merge two capture passes, sorted by time, dropping near-duplicates. */
function mergeFrames(a: FramePose[], b: FramePose[]): FramePose[] {
  const all = [...a, ...b].sort((x, y) => x.timeSec - y.timeSec);
  const merged: FramePose[] = [];
  for (const frame of all) {
    const prev = merged[merged.length - 1];
    if (prev && frame.timeSec - prev.timeSec < 0.008) continue;
    merged.push(frame);
  }
  return merged;
}

/** Fast path: play once, detect on every presented frame. */
function captureByPlayback(
  video: HTMLVideoElement,
  totalSec: number,
  steadyDetectMs: number,
  detectFrame: (timeSec: number, frames: FramePose[]) => void,
  signal?: AbortSignal,
): Promise<FramePose[]> {
  return new Promise((resolve, reject) => {
    const frames: FramePose[] = [];
    let finished = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let detectMsTotal = 0;
    let rateAdjusted = false;

    // Slow device: inference eats most of the frame budget and samples get
    // sparse. Slowing playback increases the sampling density.
    video.playbackRate = steadyDetectMs > 80 ? 0.5 : 1;

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(frames);
    };
    const fail = (err: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      if (stallTimer) clearTimeout(stallTimer);
      video.removeEventListener("ended", finish);
      signal?.removeEventListener("abort", onAbort);
      video.pause();
    };
    const onAbort = () => fail(new DOMException("Abgebrochen", "AbortError"));
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () => fail(new Error("Die Videoanalyse ist stehengeblieben.")),
        STALL_TIMEOUT_MS,
      );
    };

    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (finished) return;
      armStallTimer();
      const started = performance.now();
      try {
        detectFrame(meta.mediaTime, frames);
      } catch (err) {
        fail(err instanceof Error ? err : new Error("Pose-Erkennung fehlgeschlagen."));
        return;
      }
      detectMsTotal += performance.now() - started;
      if (!rateAdjusted && frames.length === 5) {
        rateAdjusted = true;
        if (detectMsTotal / frames.length > 80) {
          video.playbackRate = 0.5;
        }
      }
      if (meta.mediaTime >= totalSec) {
        finish();
        return;
      }
      video.requestVideoFrameCallback(onFrame);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("ended", finish, { once: true });
    armStallTimer();
    video.requestVideoFrameCallback(onFrame);
    video.currentTime = 0;
    video.play().catch(() => fail(new PlaybackBlockedError("Autoplay blockiert")));
  });
}


/** Fallback for browsers without requestVideoFrameCallback: seek-based sampling. */
async function captureBySeeking(
  video: HTMLVideoElement,
  totalSec: number,
  detectFrame: (timeSec: number, frames: FramePose[]) => void,
  signal?: AbortSignal,
): Promise<FramePose[]> {
  const frames: FramePose[] = [];
  const total = Math.max(1, Math.floor(totalSec * FALLBACK_SAMPLE_FPS));
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    const timeSec = Math.min(i / FALLBACK_SAMPLE_FPS, Math.max(0, totalSec - 0.001));
    await seekTo(video, timeSec, signal);
    detectFrame(timeSec, frames);
  }
  return frames;
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
  timeoutMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const timer = timeoutMs
      ? setTimeout(() => {
          cleanup();
          reject(
            new Error(
              "Das Video lädt nicht. Bitte erneut versuchen oder ein anderes Video wählen.",
            ),
          );
        }, timeoutMs)
      : undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
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
