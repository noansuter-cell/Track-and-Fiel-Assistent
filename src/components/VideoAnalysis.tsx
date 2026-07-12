"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeVideo, resolveDuration, type AnalyzeProgress } from "@/lib/analyzeVideo";
import {
  addRecord,
  getDefaultHeightCm,
  saveAthlete,
  setDefaultHeightCm,
  type Athlete,
} from "@/lib/athletes";
import { drawSkeleton, drawTape, type JointMarker, type TapeMeasure } from "@/lib/drawing";
import { landmarksAt, nearestFrameIndex } from "@/lib/frames";
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

const ALL_JOINTS = Object.keys(JOINT_MARKER_LANDMARKS) as ScoredJoint[];

export default function VideoAnalysis({
  videoUrl,
  mode,
  athlete,
  onAthleteUpdated,
  onBack,
}: Props) {
  const [phase, setPhase] = useState<Phase>("analyzing");
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedJoint, setSelectedJoint] = useState<ScoredJoint | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<SelectedMeasure>(null);
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
  const mppRef = useRef<number | null>(null);
  const savedRef = useRef(false);
  const feedbackRef = useRef<HTMLSpanElement>(null);
  const feedbackDotRef = useRef<HTMLSpanElement>(null);

  const metrics: Metrics | null = useMemo(
    () => (analysis ? computeMetrics(analysis, mode) : null),
    [analysis, mode],
  );

  // --- Analysis pass: run the whole video through the landmarker once. ---
  useEffect(() => {
    const video = analysisVideoRef.current;
    if (!video) return;
    const controller = new AbortController();
    setPhase("analyzing");
    setProgress(null);
    setAnalysis(null);
    setSelectedJoint(null);
    setSelectedMeasure(null);
    savedRef.current = false;
    analyzeVideo(video, setProgress, controller.signal)
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

  // Pixel→meter calibration follows the current height input.
  useEffect(() => {
    mppRef.current = metrics ? metersPerPixel(metrics.segmentChainPx, heightCm) : null;
    const video = videoRef.current;
    if (video) drawAt(video.currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightCm, metrics]);

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, athlete]);

  const buildTape = useCallback(
    (measure: SelectedMeasure): TapeMeasure | null => {
      if (!measure || !metrics) return null;
      const mpp = mppRef.current;
      const format = (px: number) =>
        mpp ? `${(px * mpp).toFixed(2)} m` : "Grösse eingeben für Meter";
      if (measure.kind === "step") {
        const step = metrics.steps[measure.index];
        if (!step) return null;
        return {
          x1: step.x1,
          y1: step.groundY,
          x2: step.x2,
          y2: step.groundY,
          label: format(step.lengthPx),
        };
      }
      if (measure.kind === "flight" && metrics.jump) {
        const j = metrics.jump;
        return {
          x1: j.apexX,
          y1: j.takeoffHipY,
          x2: j.apexX,
          y2: j.apexY,
          label: format(j.flightHeightPx),
        };
      }
      return null;
    },
    [metrics],
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
      drawSkeleton(ctx, landmarks, markers);

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
    const video = videoRef.current;
    if (video) drawAt(video.currentTime);
  }, [selectedJoint, selectedMeasure, drawAt]);

  // --- Playback loop: keep overlay and slider in sync. ---
  useEffect(() => {
    if (phase !== "ready" || !analysis) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = analysis.videoWidth;
    canvas.height = analysis.videoHeight;

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
    drawAt(clamped);
    if (sliderRef.current) sliderRef.current.value = String(clamped);
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

  /** Tap on a colored joint selects it; tapping elsewhere toggles play. */
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !analysis || !metrics) {
      togglePlay();
      return;
    }
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
    if (bestJoint && bestDist <= 32) {
      setSelectedJoint((prev) => (prev === bestJoint ? null : bestJoint));
    } else {
      togglePlay();
    }
  };

  if (phase === "error") {
    return (
      <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={onBack} style={{ alignSelf: "flex-start" }}>‹ Zurück</button>
        <p style={{ color: "#f28b82" }}>Fehler: {errorMessage}</p>
      </main>
    );
  }

  if (phase === "analyzing" || !analysis || !metrics) {
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
    <main style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onBack}>‹ Fertig</button>
        <span style={{ color: "#9aa0a6", fontSize: 13 }}>
          {athlete ? `${athlete.name} · ` : ""}
          {MODE_LABELS[metrics.mode]} · {analysis.frames.length} Frames
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {metrics.cadenceStepsPerSec !== null && (
          <span style={statChipStyle}>
            Kadenz ≈ {metrics.cadenceStepsPerSec.toFixed(1)} Schritte/s
          </span>
        )}
        {metrics.meanTorsoLeanDeg !== null && (
          <span style={statChipStyle}>Ø Vorlage {metrics.meanTorsoLeanDeg.toFixed(0)}°</span>
        )}
        {metrics.jump?.takeoffAngleDeg != null && (
          <span style={statChipStyle}>
            ∠ Absprung {metrics.jump.takeoffAngleDeg.toFixed(0)}° (Ziel 18–24°)
          </span>
        )}
        <label style={{ ...statChipStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Grösse
          <input
            type="number"
            inputMode="numeric"
            defaultValue={heightCm ?? ""}
            placeholder="cm"
            onChange={(e) => updateHeight(e.target.value)}
            style={{
              width: 52,
              font: "inherit",
              color: "inherit",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid #3c4250",
              outline: "none",
              textAlign: "center",
            }}
          />
          cm
        </label>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: `calc(55dvh * ${aspect})`,
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
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: "pointer",
          }}
        />
      </div>

      {(metrics.events.length > 0 || metrics.steps.length > 0 || metrics.jump) && (
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 4,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {metrics.jump && (
            <button
              className={selectedMeasure?.kind === "flight" ? "primary" : undefined}
              onClick={() => {
                setSelectedMeasure((prev) => (prev?.kind === "flight" ? null : { kind: "flight" }));
                jumpToEvent(analysis.frames[metrics.jump!.apexIndex].timeSec);
              }}
              style={chipStyle}
            >
              📏 Flughöhe
            </button>
          )}
          {metrics.steps.slice(0, 8).map((step, i) => (
            <button
              key={`step-${i}`}
              className={
                selectedMeasure?.kind === "step" && selectedMeasure.index === i
                  ? "primary"
                  : undefined
              }
              onClick={() => {
                setSelectedMeasure((prev) =>
                  prev?.kind === "step" && prev.index === i ? null : { kind: "step", index: i },
                );
                jumpToEvent(step.timeSec);
              }}
              style={chipStyle}
            >
              📏 Schritt {i + 1}
            </button>
          ))}
          {metrics.events.map((event, i) => (
            <button key={`ev-${i}`} onClick={() => jumpToEvent(event.timeSec)} style={chipStyle}>
              {event.kind === "contact"
                ? "👣"
                : event.kind === "kneelift"
                  ? "🦵"
                  : event.kind === "takeoff"
                    ? "🛫"
                    : event.kind === "apex"
                      ? "🪂"
                      : "🛬"}{" "}
              {event.label} · {event.timeSec.toFixed(2)}s
            </button>
          ))}
        </div>
      )}

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
          fontSize: 14,
          lineHeight: 1.5,
          minHeight: 66,
        }}
      >
        {selectedJoint ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
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
                onClick={() => setSelectedJoint(null)}
                style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
            <span ref={feedbackRef} style={{ color: "#c6cad2" }} />
          </>
        ) : (
          <span style={{ color: "#9aa0a6" }}>
            Tippe einen farbigen Punkt im Video an, um Winkel &amp; Feedback zu sehen.
            {athlete && (
              <>
                {" "}
                Diese Analyse wurde in der Akte von {athlete.name} gespeichert.
              </>
            )}
            <br />
            <span style={{ fontSize: 12 }}>
              🟢 gut · 🟡 okay · 🟠 verbesserungswürdig · 🔴 fehlerhaft
            </span>
          </span>
        )}
      </section>
    </main>
  );
}

const statChipStyle: React.CSSProperties = {
  background: "#1a1d24",
  border: "1px solid #2a2f3a",
  borderRadius: 999,
  padding: "4px 12px",
  fontSize: 13,
  color: "#c6cad2",
};

const chipStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  whiteSpace: "nowrap",
  borderRadius: 999,
  flexShrink: 0,
};
