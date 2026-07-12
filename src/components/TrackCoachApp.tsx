"use client";

import { useCallback, useRef, useState } from "react";
import VideoRecorder from "./VideoRecorder";
import VideoAnalysis from "./VideoAnalysis";

type Screen = "home" | "record" | "analyze";

export default function TrackCoachApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openVideo = useCallback((blob: Blob) => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setScreen("analyze");
  }, []);

  const goHome = useCallback(() => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setScreen("home");
  }, []);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) openVideo(file);
    e.target.value = "";
  };

  if (screen === "record") {
    return <VideoRecorder onRecorded={openVideo} onCancel={goHome} />;
  }

  if (screen === "analyze" && videoUrl) {
    return <VideoAnalysis videoUrl={videoUrl} onBack={goHome} />;
  }

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
      <h1 style={{ fontSize: 28 }}>TrackCoach</h1>
      <p style={{ color: "#9aa0a6", textAlign: "center", maxWidth: 320 }}>
        Phase 1 – Pose Tracking: Video aufnehmen oder laden, Skeleton-Overlay
        prüfen.
      </p>
      <button
        className="primary"
        style={{ width: 280 }}
        onClick={() => setScreen("record")}
      >
        📹 Video aufnehmen
      </button>
      <button style={{ width: 280 }} onClick={() => fileInputRef.current?.click()}>
        🖼️ Video aus Galerie laden
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
      <p style={{ color: "#5f6368", fontSize: 12, textAlign: "center", maxWidth: 320 }}>
        Alles läuft lokal auf dem Gerät – kein Upload.
      </p>
    </main>
  );
}
