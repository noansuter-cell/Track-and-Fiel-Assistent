"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeVideo,
  resolveDuration,
  type AnalyzeProgress,
  type AnalyzeStatus,
} from "@/lib/analyzeVideo";
import {
  addRecord,
  getDefaultHeightCm,
  saveAthlete,
  setDefaultHeightCm,
  type Athlete,
} from "@/lib/athletes";
import {
  drawGhost,
  drawSkeleton,
  drawTape,
  type JointMarker,
  type TapeMeasure,
} from "@/lib/drawing";
import { landmarksAt, nearestFrameIndex } from "@/lib/frames";
import { ghostSegmentsAt } from "@/lib/ghost";
import {
  computeMetrics,
  JOINT_LABELS,
  JOINT_MARKER_LANDMARKS,
  metersPerPixel,
  MODE_LABELS,
  scoreColor,
  type Metrics,
  type Mode,
  type ScoredJoint,
} from "@/lib/metrics";
import type { PoseAnalysis } from "@/lib/types";

interface Props {
  videoUrl: string;
  mode: Mode;
  athlete: Athlete | null;
  onAthleteUpdated: () => void;
  onBack: () => void;
}

type Phase = "analyzing" | "ready" | "error";
type SelectedMeasure = { kind: "step"; index: number } | { kind: "flight" } | null;
type Sheet = { kind: "joint" } | { kind: "info" } | null;

const ALL_JOINTS = Object.keys(JOINT_MARKER_LANDMARKS) as ScoredJoint[];

export default function VideoAnalysis({
  videoUrl,
  mode,
  athlete,
  onAthleteUpdated,
  onBack,
}: Props) {
  const [phase, setPhase] = useState<Phase>("analyzing");
  const [status, setStatus] = useState<AnalyzeStatus>("model");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedJoint, setSelectedJoint] = useState<ScoredJoint | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<SelectedMeasure>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showGhost, setShowGhost] = useState(false);
  const [heightCm, setHeightCm] = useState<number | null>(
    () => athlete?.heightCm ?? getDefaultHeightCm(),
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const scrubbingRef = useRef(false);
  const selectedJointRef = useRef<ScoredJoint | null>(null);
  const selectedMeasureRef = useRef<SelectedMeasure>(null);
  const showGhostRef = useRef(false);
  const savedRef = useRef(false);
  const smoothingRef = useRef<{
    timeSec: number;
    landmarks: { x: number; y: number }[];
  } | null>(null);
  const feedbackRef = useRef<HTMLSpanElement>(null);
  const feedbackDotRef = useRef<HTMLSpanElement>(null);

  const metrics: Metrics | null = useMemo(
    () => (analysis ? computeMetrics(analysis, mode) : null),
    [analysis, mode],
  );

  // --- Analysis pass ---
  useEffect(() => {
    const video = analysisVideoRef.current;
    if (!video) return;
    const controller = new AbortController();
    setPhase("analyzing");
    setStatus("model");
    setProgress(null);
    setAnalysis(null);
    setSelectedJoint(null);
    setSelectedMeasure(null);
    setSheet(null);
    savedRef.current = false;
    analyzeVideo(video, setProgress, controller.signal, setStatus)
      .then((result) => {
        setAnalysis(result);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMessage(err instanceof Error ? err.message : "Analyse fehlgeschlagen.");
        setPhase("error");
      });
    return () => controller.abort();
  }, [videoUrl]);

  // Persist analysis summary into the athlete's record — once per video.
  useEffect(() => {
    if (!metrics || !athlete || savedRef.current) return;
    savedRef.current = true;
    const jointSums = new Map<ScoredJoint, { sum: number; count: number }>();
    for (const frame of metrics.perFrame) {
      for (const joint of ALL_JOINTS) {
        const assessment = frame[joint];
        if (!assessment) continue;
        const entry = jointSums.get(joint) ?? { sum: 0, count: 0 };
        entry.sum += assessment.score;
        entry.count++;
        jointSums.set(joint, entry);
      }
    }
    const jointAvgScores: Partial<Record<ScoredJoint, number>> = {};
    for (const [joint, { sum, count }] of jointSums) {
      if (count > 0) jointAvgScores[joint] = Math.round(sum / count);
    }
    const mpp = metersPerPixel(metrics.segmentChainPx, heightCm);
    addRecord({
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      athleteId: athlete.id,
      dateISO: new Date().toISOString(),
      mode: metrics.mode,
      cadenceStepsPerSec: metrics.cadenceStepsPerSec,
      meanTorsoLeanDeg: metrics.meanTorsoLeanDeg,
      jointAvgScores,
      stepLengthsM: mpp ? metrics.steps.map((s) => s.lengthPx * mpp) : [],
      flightHeightM: mpp && metrics.jump ? metrics.jump.flightHeightPx * mpp : null,
      takeoffAngleDeg: metrics.jump?.takeoffAngleDeg ?? null,
      thumbnail: analysis?.thumbnail ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, athlete]);

  const buildTape = useCallback(
    (measure: SelectedMeasure): TapeMeasure | null => {
      if (!measure || !metrics) return null;
      const mpp = metersPerPixel(metrics.segmentChainPx, heightCm);
      const format = (px: number) => (mpp ? `${(px * mpp).toFixed(2)} m` : "Grösse setzen (ⓘ)");
      if (measure.kind === "step") {
        const step = metrics.steps[measure.index];
        if (!step) return null;
        return { x1: step.x1, y1: step.groundY, x2: step.x2, y2: step.groundY, label: format(step.lengthPx) };
      }
      if (measure.kind === "flight" && metrics.jump) {
        const j = metrics.jump;
        return { x1: j.apexX, y1: j.takeoffHipY, x2: j.apexX, y2: j.apexY, label: format(j.flightHeightPx) };
      }
      return null;
    },
    [metrics, heightCm],
  );

  const drawAt = useCallback(
    (timeSec: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !analysis || !metrics) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const landmarks = landmarksAt(analysis, timeSec);
      const idx = nearestFrameIndex(analysis, timeSec);
      const assessments = idx >= 0 ? metrics.perFrame[idx] : {};

      const markers: JointMarker[] = [];
      for (const joint of ALL_JOINTS) {
        const assessment = assessments[joint];
        if (!assessment) continue;
        for (const landmarkIndex of JOINT_MARKER_LANDMARKS[joint]) {
          markers.push({
            landmarkIndex,
            color: scoreColor(assessment.score),
            selected: selectedJointRef.current === joint,
          });
        }
      }

      // Temporal smoothing: blend toward the new pose during playback so the
      // overlay glides instead of jittering with per-frame detection noise.
      let displayLandmarks = landmarks;
      const prev = smoothingRef.current;
      if (
        landmarks &&
        prev &&
        prev.landmarks.length === landmarks.length &&
        Math.abs(timeSec - prev.timeSec) < 0.15
      ) {
        const blend = 0.45;
        displayLandmarks = landmarks.map((lm, i) => ({
          ...lm,
          x: prev.landmarks[i].x + (lm.x - prev.landmarks[i].x) * blend,
          y: prev.landmarks[i].y + (lm.y - prev.landmarks[i].y) * blend,
        }));
      }
      smoothingRef.current = displayLandmarks
        ? { timeSec, landmarks: displayLandmarks }
        : null;

      // Clear happens inside drawSkeleton; ghost must be drawn after it.
      drawSkeleton(ctx, displayLandmarks, markers, performance.now());
      if (showGhostRef.current) {
        const ghost = ghostSegmentsAt(analysis, metrics, timeSec);
        if (ghost) drawGhost(ctx, ghost.segments, ghost.alpha);
      }
      const tape = buildTape(selectedMeasureRef.current);
      if (tape) drawTape(ctx, tape);

      const selected = selectedJointRef.current;
      if (selected && feedbackRef.current && feedbackDotRef.current) {
        const assessment = assessments[selected];
        if (assessment) {
          feedbackRef.current.textContent = assessment.feedback;
          feedbackDotRef.current.style.backgroundColor = scoreColor(assessment.score);
        } else {
          feedbackRef.current.textContent = "Für diesen Moment keine verlässlichen Daten.";
          feedbackDotRef.current.style.backgroundColor = "#5f6368";
        }
      }
    },
    [analysis, metrics, buildTape],
  );

  useEffect(() => {
    selectedJointRef.current = selectedJoint;
    selectedMeasureRef.current = selectedMeasure;
    showGhostRef.current = showGhost;
    const video = videoRef.current;
    if (video) drawAt(video.currentTime);
  }, [selectedJoint, selectedMeasure, showGhost, drawAt]);

  // --- Playback loop ---
  useEffect(() => {
    if (phase !== "ready" || !analysis) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = analysis.videoWidth;
    canvas.height = analysis.videoHeight;

    let primed = false;
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
      const sliderTime = parseFloat(sliderRef.current?.value ?? "0");
      if (sliderTime > 0 && Math.abs(video.currentTime - sliderTime) > 0.01) {
        video.currentTime = sliderTime;
      }
      primed = true;
      drawAt(video.currentTime);
    };
    void prime();

    let rafHandle = 0;
    const loop = () => {
      if (primed && !scrubbingRef.current) {
        drawAt(video.currentTime);
        const slider = sliderRef.current;
        if (slider) {
          slider.value = String(video.currentTime);
          slider.style.setProperty(
            "--fill",
            `${(video.currentTime / analysis.durationSec) * 100}%`,
          );
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
    drawAt(clamped);
    const slider = sliderRef.current;
    if (slider) {
      slider.value = String(clamped);
      slider.style.setProperty("--fill", `${(clamped / analysis.durationSec) * 100}%`);
    }
  };

  const stepFrame = (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || !analysis) return;
    video.pause();
    const idx = nearestFrameIndex(analysis, video.currentTime);
    const next = Math.min(Math.max(idx + direction, 0), analysis.frames.length - 1);
    seekTo(analysis.frames[next].timeSec);
  };

  const jumpToEvent = (timeSec: number) => {
    videoRef.current?.pause();
    seekTo(timeSec);
  };

  const updateHeight = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const value = Number.isFinite(parsed) && parsed >= 100 && parsed <= 230 ? parsed : null;
    setHeightCm(value);
    if (athlete) {
      saveAthlete({ ...athlete, heightCm: value });
      onAthleteUpdated();
    } else {
      setDefaultHeightCm(value);
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !analysis || !metrics) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const landmarks = landmarksAt(analysis, video.currentTime);
    const idx = nearestFrameIndex(analysis, video.currentTime);
    const assessments = idx >= 0 ? metrics.perFrame[idx] : {};

    let bestJoint: ScoredJoint | null = null;
    let bestDist = Infinity;
    if (landmarks) {
      for (const joint of ALL_JOINTS) {
        if (!assessments[joint]) continue;
        for (const landmarkIndex of JOINT_MARKER_LANDMARKS[joint]) {
          const lm = landmarks[landmarkIndex];
          if (!lm) continue;
          const dist = Math.hypot((lm.x - px) * rect.width, (lm.y - py) * rect.height);
          if (dist < bestDist) {
            bestDist = dist;
            bestJoint = joint;
          }
        }
      }
    }
    if (bestJoint && bestDist <= 34) {
      setSelectedJoint((prev) => (prev === bestJoint ? null : bestJoint));
      setSheet({ kind: "joint" });
      videoRef.current?.pause();
    } else if (sheet) {
      setSheet(null);
      setSelectedJoint(null);
    } else {
      togglePlay();
    }
  };

  const aspect = analysis ? analysis.videoWidth / analysis.videoHeight : 16 / 9;
  const mpp = metrics ? metersPerPixel(metrics.segmentChainPx, heightCm) : null;

  // --- Fullscreen stage: the video IS the screen; everything floats on top ---
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      {/* Video area, letterboxed to fit, canvas exactly on top */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          margin: "auto",
          aspectRatio: `${aspect}`,
          maxWidth: "100vw",
          maxHeight: "100dvh",
          width: `min(100vw, calc(100dvh * ${aspect}))`,
        }}
      >
        {phase === "analyzing" ? (
          <video
            ref={analysisVideoRef}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              muted
              playsInline
              preload="auto"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
          </>
        )}
      </div>

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: "max(14px, env(safe-area-inset-top))",
          left: 14,
          right: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          zIndex: 30,
        }}
      >
        <button className="glass chip" onClick={onBack} aria-label="Zurück">
          ‹ Zurück
        </button>
        {phase === "ready" && metrics && (
          <div style={{ display: "flex", gap: 8 }}>
            {metrics.mode === "sprint" && metrics.contacts.length >= 2 && (
              <button
                className={`chip ${showGhost ? "primary" : "glass"}`}
                onClick={() => setShowGhost((v) => !v)}
              >
                ✨ Ideal
              </button>
            )}
            <button
              className={`chip ${sheet?.kind === "info" ? "primary" : "glass"}`}
              onClick={() => {
                setSelectedJoint(null);
                setSheet((s) => (s?.kind === "info" ? null : { kind: "info" }));
              }}
              aria-label="Übersicht"
            >
              ⓘ
            </button>
          </div>
        )}
      </div>

      {/* Analyzing / error overlays */}
      {phase === "analyzing" && (
        <div
          className="glass fade-in"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "max(28px, env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            borderRadius: 20,
            padding: "16px 22px",
            width: "min(88vw, 380px)",
            textAlign: "center",
            zIndex: 30,
          }}
        >
          <p style={{ fontSize: 14, marginBottom: 10 }}>
            {status === "model"
              ? "Lade Pose-Modell… (einmalig, danach im Cache)"
              : status === "video"
                ? "Bereite Video vor…"
                : "Analysiere Video…"}
          </p>
          <div style={{ height: 5, background: "rgba(255,255,255,0.15)", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                width: `${progress ? Math.min(100, (progress.processedSec / progress.totalSec) * 100) : 0}%`,
                height: "100%",
                background: "var(--text)",
                borderRadius: 999,
                transition: "width 150ms linear",
              }}
            />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div
          className="glass"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            borderRadius: 20,
            padding: 22,
            width: "min(88vw, 380px)",
            textAlign: "center",
            zIndex: 30,
          }}
        >
          <p style={{ color: "#f28b82", marginBottom: 14 }}>{errorMessage}</p>
          <button className="primary" onClick={onBack}>Zurück</button>
        </div>
      )}

      {/* Bottom controls */}
      {phase === "ready" && analysis && metrics && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "0 12px max(12px, env(safe-area-inset-bottom))",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 20,
            background: "linear-gradient(transparent, rgba(0,0,0,0.55))",
            paddingTop: 40,
          }}
        >
          {(metrics.events.length > 0 || metrics.steps.length > 0 || metrics.jump) && (
            <div
              style={{
                display: "flex",
                gap: 6,
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: 2,
              }}
            >
              {metrics.jump && (
                <button
                  className={`chip ${selectedMeasure?.kind === "flight" ? "primary" : "glass"}`}
                  onClick={() => {
                    setSelectedMeasure((p) => (p?.kind === "flight" ? null : { kind: "flight" }));
                    jumpToEvent(analysis.frames[metrics.jump!.apexIndex].timeSec);
                  }}
                >
                  📏 Flughöhe
                </button>
              )}
              {metrics.steps.slice(0, 8).map((step, i) => (
                <button
                  key={`s-${i}`}
                  className={`chip ${
                    selectedMeasure?.kind === "step" && selectedMeasure.index === i
                      ? "primary"
                      : "glass"
                  }`}
                  onClick={() => {
                    setSelectedMeasure((p) =>
                      p?.kind === "step" && p.index === i ? null : { kind: "step", index: i },
                    );
                    jumpToEvent(step.timeSec);
                  }}
                >
                  📏 Schritt {i + 1}
                </button>
              ))}
              {metrics.events.map((event, i) => (
                <button key={`e-${i}`} className="chip glass" onClick={() => jumpToEvent(event.timeSec)}>
                  {event.kind === "contact"
                    ? "👣"
                    : event.kind === "kneelift"
                      ? "🦵"
                      : event.kind === "takeoff"
                        ? "🛫"
                        : event.kind === "apex"
                          ? "🪂"
                          : "🛬"}{" "}
                  {event.label}
                </button>
              ))}
            </div>
          )}

          <div
            className="glass"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              padding: "8px 14px 8px 8px",
            }}
          >
            <button style={roundBtnStyle} onClick={() => stepFrame(-1)} aria-label="Frame zurück">
              ⏮
            </button>
            <button
              style={{ ...roundBtnStyle, background: "var(--accent)", color: "#101114" }}
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Abspielen"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button style={roundBtnStyle} onClick={() => stepFrame(1)} aria-label="Frame vor">
              ⏭
            </button>
            <input
              ref={sliderRef}
              className="timeline"
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
        </div>
      )}

      {/* Bottom sheet: joint feedback or overview */}
      {phase === "ready" && metrics && sheet && (
        <section className="sheet glass" key={sheet.kind + (selectedJoint ?? "")}>
          {sheet.kind === "joint" && selectedJoint ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  ref={feedbackDotRef}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    display: "inline-block",
                    backgroundColor: "#5f6368",
                    flexShrink: 0,
                  }}
                />
                <strong>{JOINT_LABELS[selectedJoint]}</strong>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setSheet(null);
                    setSelectedJoint(null);
                  }}
                  style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 13, borderRadius: 999 }}
                >
                  ✕
                </button>
              </div>
              <span ref={feedbackRef} style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.5 }} />
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <strong>
                  {athlete ? `${athlete.name} · ` : ""}
                  {MODE_LABELS[metrics.mode]}
                </strong>
                <button
                  className="ghost-btn"
                  onClick={() => setSheet(null)}
                  style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 13, borderRadius: 999 }}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--text-2)" }}>
                {metrics.cadenceStepsPerSec !== null && (
                  <span className="chip" style={{ background: "var(--surface-2)" }}>
                    Kadenz ≈ {metrics.cadenceStepsPerSec.toFixed(1)}/s
                  </span>
                )}
                {metrics.meanTorsoLeanDeg !== null && (
                  <span className="chip" style={{ background: "var(--surface-2)" }}>
                    Ø Vorlage {metrics.meanTorsoLeanDeg.toFixed(0)}°
                  </span>
                )}
                {metrics.jump?.takeoffAngleDeg != null && (
                  <span className="chip" style={{ background: "var(--surface-2)" }}>
                    ∠ Absprung {metrics.jump.takeoffAngleDeg.toFixed(0)}° (Ziel 18–24°)
                  </span>
                )}
                <span className="chip num" style={{ background: "var(--surface-2)" }}>
                  {analysis?.frames.length} Frames
                </span>
                <label className="chip" style={{ background: "var(--surface-2)", gap: 4 }}>
                  Grösse
                  <input
                    type="number"
                    inputMode="numeric"
                    defaultValue={heightCm ?? ""}
                    placeholder="—"
                    onChange={(e) => updateHeight(e.target.value)}
                    style={{
                      width: 46,
                      font: "inherit",
                      color: "inherit",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--line)",
                      outline: "none",
                      textAlign: "center",
                    }}
                  />
                  cm
                </label>
              </div>
              {!mpp && (
                <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 8 }}>
                  Grösse eintragen, damit Schrittlänge und Flughöhe in Metern
                  angezeigt werden.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

const roundBtnStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: "50%",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 15,
  border: "none",
  background: "rgba(255,255,255,0.12)",
  flexShrink: 0,
};
