"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeVideo, resolveDuration, type AnalyzeProgress } from "@/lib/analyzeVideo";
import { drawSkeleton } from "@/lib/drawing";
import { bodyConfidence, kneeAngle } from "@/lib/geometry";
import type { PoseAnalysis } from "@/lib/types";

interface Props {
  videoUrl: string;
  onBack: () => void;
}

type Phase = "analyzing" | "ready" | "error";

export default function VideoAnalysis({ videoUrl, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("analyzing");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [playing, setPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const scrubbingRef = useRef(false);
  const lastDrawnFrameRef = useRef(-1);

  // Debug panel values are written straight into the DOM (no re-render per frame).
  const debugTimeRef = useRef<HTMLSpanElement>(null);
  const debugFrameRef = useRef<HTMLSpanElement>(null);
  const debugDetectedRef = useRef<HTMLSpanElement>(null);
  const debugConfRef = useRef<HTMLSpanElement>(null);
  const debugKneeLRef = useRef<HTMLSpanElement>(null);
  const debugKneeRRef = useRef<HTMLSpanElement>(null);

  // --- Analysis pass: run the whole video through the landmarker once. ---
  useEffect(() => {
    const video = analysisVideoRef.current;
    if (!video) return;
    const controller = new AbortController();
    setPhase("analyzing");
    setProgress(null);
    setAnalysis(null);
    analyzeVideo(video, setProgress, controller.signal)
      .then((result) => {
        setAnalysis(result);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMessage(
          err instanceof Error ? err.message : "Analyse fehlgeschlagen.",
        );
        setPhase("error");
      });
    return () => controller.abort();
  }, [videoUrl]);

  // Frames come from real presented video frames, so they are not uniformly
  // spaced — binary-search the nearest cached frame.
  const frameIndexAt = useCallback(
    (timeSec: number): number => {
      if (!analysis || analysis.frames.length === 0) return -1;
      const frames = analysis.frames;
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
    },
    [analysis],
  );

  const drawAt = useCallback(
    (timeSec: number, force = false) => {
      const canvas = canvasRef.current;
      if (!canvas || !analysis) return;
      const idx = frameIndexAt(timeSec);
      if (idx < 0) return;
      if (!force && idx === lastDrawnFrameRef.current) return;
      lastDrawnFrameRef.current = idx;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const frame = analysis.frames[idx];
      drawSkeleton(ctx, frame.landmarks);
      updateDebug(timeSec, idx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis, frameIndexAt],
  );

  function updateDebug(timeSec: number, idx: number) {
    if (!analysis) return;
    const frame = analysis.frames[idx];
    const lm = frame.landmarks;
    setText(debugTimeRef, `${timeSec.toFixed(2)} s`);
    setText(debugFrameRef, `${idx + 1} / ${analysis.frames.length}`);
    setText(debugDetectedRef, lm ? "ja" : "nein");
    const conf = lm ? bodyConfidence(lm) : null;
    setText(debugConfRef, conf !== null ? `${(conf * 100).toFixed(0)} %` : "–");
    const left = lm ? kneeAngle(lm, "left") : null;
    const right = lm ? kneeAngle(lm, "right") : null;
    setText(debugKneeLRef, left !== null ? `${left.toFixed(1)}°` : "–");
    setText(debugKneeRRef, right !== null ? `${right.toFixed(1)}°` : "–");
  }

  // --- Playback loop: keep overlay, slider and debug panel in sync. ---
  useEffect(() => {
    if (phase !== "ready" || !analysis) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = analysis.videoWidth;
    canvas.height = analysis.videoHeight;
    lastDrawnFrameRef.current = -1;

    // The sync loop stays off until priming is done, so the duration fix
    // can't fight with (or overwrite) an early user seek.
    let primed = false;

    // MediaRecorder WebM blobs report duration = Infinity until poked.
    const prime = async () => {
      try {
        if (video.readyState === 0) {
          await new Promise<void>((resolve) => {
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          });
        }
        await resolveDuration(video);
      } catch {
        // durationSec from the analysis pass is the fallback source of truth.
      }
      // resolveDuration resets currentTime to 0 — restore any seek the user
      // already made while the duration was being resolved.
      const sliderTime = parseFloat(sliderRef.current?.value ?? "0");
      if (sliderTime > 0 && Math.abs(video.currentTime - sliderTime) > 0.01) {
        video.currentTime = sliderTime;
      }
      primed = true;
      drawAt(video.currentTime, true);
    };
    void prime();

    let rafHandle = 0;
    const loop = () => {
      if (primed && !scrubbingRef.current) {
        drawAt(video.currentTime);
        if (sliderRef.current) {
          sliderRef.current.value = String(video.currentTime);
        }
      }
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      cancelAnimationFrame(rafHandle);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [phase, analysis, drawAt]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const seekTo = (timeSec: number) => {
    const video = videoRef.current;
    if (!video || !analysis) return;
    const clamped = Math.min(Math.max(timeSec, 0), analysis.durationSec);
    video.currentTime = clamped;
    // Draw from cache immediately — no waiting for the browser to finish seeking.
    drawAt(clamped, true);
    if (sliderRef.current) sliderRef.current.value = String(clamped);
  };

  const stepFrame = (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || !analysis) return;
    video.pause();
    const idx = frameIndexAt(video.currentTime);
    const next = Math.min(Math.max(idx + direction, 0), analysis.frames.length - 1);
    seekTo(analysis.frames[next].timeSec);
  };

  if (phase === "error") {
    return (
      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={onBack} style={{ alignSelf: "flex-start" }}>‹ Zurück</button>
        <p style={{ color: "#f28b82" }}>Fehler: {errorMessage}</p>
      </main>
    );
  }

  if (phase === "analyzing" || !analysis) {
    const percent = progress
      ? Math.min(100, Math.round((progress.processedSec / progress.totalSec) * 100))
      : 0;
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
        }}
      >
        {/* Must stay visible: requestVideoFrameCallback only fires for
            composited videos, and the analysis captures its frames live. */}
        <video
          ref={analysisVideoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          style={{
            width: "100%",
            maxWidth: 480,
            maxHeight: "45dvh",
            background: "#000",
            borderRadius: 8,
            objectFit: "contain",
          }}
        />
        <p>{progress ? "Analysiere Video…" : "Lade Pose-Modell…"}</p>
        <div
          style={{
            width: 280,
            height: 8,
            background: "#2a2f3a",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "#2f6fed",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <p style={{ color: "#9aa0a6", fontVariantNumeric: "tabular-nums" }}>
          {progress
            ? `${progress.processedSec.toFixed(1)} s / ${progress.totalSec.toFixed(1)} s (${percent} %)`
            : ""}
        </p>
        <button onClick={onBack}>Abbrechen</button>
      </main>
    );
  }

  const aspect = analysis.videoWidth / analysis.videoHeight;

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onBack}>‹ Neues Video</button>
        <span style={{ color: "#9aa0a6", fontSize: 13 }}>
          {analysis.videoWidth}×{analysis.videoHeight} · {analysis.frames.length} Frames analysiert
        </span>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: `calc(60dvh * ${aspect})`,
          aspectRatio: `${analysis.videoWidth} / ${analysis.videoHeight}`,
          margin: "0 auto",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onClick={togglePlay}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => stepFrame(-1)} aria-label="Frame zurück">⏮</button>
        <button className="primary" style={{ minWidth: 90 }} onClick={togglePlay}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={() => stepFrame(1)} aria-label="Frame vor">⏭</button>
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={analysis.durationSec}
          step={0.01}
          defaultValue={0}
          onPointerDown={() => {
            scrubbingRef.current = true;
            videoRef.current?.pause();
          }}
          onPointerUp={() => {
            scrubbingRef.current = false;
          }}
          onInput={(e) => seekTo(parseFloat(e.currentTarget.value))}
          aria-label="Video-Timeline"
        />
      </div>

      <section
        style={{
          background: "#1a1d24",
          border: "1px solid #2a2f3a",
          borderRadius: 8,
          padding: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
        }}
      >
        <span style={{ gridColumn: "1 / -1", color: "#9aa0a6" }}>Debug-Panel</span>
        <span>Zeit: <span ref={debugTimeRef}>–</span></span>
        <span>Frame: <span ref={debugFrameRef}>–</span></span>
        <span>Pose erkannt: <span ref={debugDetectedRef}>–</span></span>
        <span>Confidence: <span ref={debugConfRef}>–</span></span>
        <span>Kniewinkel links: <span ref={debugKneeLRef}>–</span></span>
        <span>Kniewinkel rechts: <span ref={debugKneeRRef}>–</span></span>
      </section>
    </main>
  );
}

function setText(ref: React.RefObject<HTMLSpanElement | null>, text: string) {
  if (ref.current) ref.current.textContent = text;
}
