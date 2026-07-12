"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listAthletes,
  newAthlete,
  saveAthlete,
  type Athlete,
} from "@/lib/athletes";
import { MODE_LABELS, type Mode } from "@/lib/metrics";
import { getPoseLandmarker } from "@/lib/pose";
import AthleteDetail from "./AthleteDetail";
import VideoAnalysis from "./VideoAnalysis";
import VideoRecorder from "./VideoRecorder";

type Screen = "home" | "newAthlete" | "athlete" | "record" | "analyze";

export default function TrackCoachApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [currentAthlete, setCurrentAthlete] = useState<Athlete | null>(null);
  const [mode, setMode] = useState<Mode>("sprint");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newName, setNewName] = useState("");
  const [newHeight, setNewHeight] = useState("");

  useEffect(() => {
    setAthletes(listAthletes());
    // Warm the model download/compile while the user is still picking a video.
    void getPoseLandmarker().catch(() => undefined);
  }, []);

  const openVideo = useCallback((blob: Blob) => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setScreen("analyze");
  }, []);

  const closeVideo = useCallback(() => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setScreen(currentAthlete ? "athlete" : "home");
  }, [currentAthlete]);

  const startCapture = (source: "camera" | "gallery", captureMode: Mode) => {
    setMode(captureMode);
    if (source === "camera") setScreen("record");
    else fileInputRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) openVideo(file);
    e.target.value = "";
  };

  const createAthlete = () => {
    const name = newName.trim();
    if (!name) return;
    const height = parseInt(newHeight, 10);
    const athlete = newAthlete(name, Number.isFinite(height) ? height : null);
    saveAthlete(athlete);
    setAthletes(listAthletes());
    setCurrentAthlete(athlete);
    setNewName("");
    setNewHeight("");
    setScreen("athlete");
  };

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/*"
      style={{ display: "none" }}
      onChange={onFileSelected}
    />
  );

  if (screen === "record") {
    return (
      <VideoRecorder
        onRecorded={openVideo}
        onCancel={() => setScreen(currentAthlete ? "athlete" : "home")}
      />
    );
  }

  if (screen === "analyze" && videoUrl) {
    return (
      <>
        <VideoAnalysis
          videoUrl={videoUrl}
          mode={mode}
          athlete={currentAthlete}
          onAthleteUpdated={() => setAthletes(listAthletes())}
          onBack={closeVideo}
        />
        {hiddenFileInput}
      </>
    );
  }

  if (screen === "athlete" && currentAthlete) {
    return (
      <>
        <AthleteDetail
          athlete={currentAthlete}
          onStart={startCapture}
          onBack={() => {
            setCurrentAthlete(null);
            setAthletes(listAthletes());
            setScreen("home");
          }}
        />
        {hiddenFileInput}
      </>
    );
  }

  if (screen === "newAthlete") {
    return (
      <main style={screenStyle}>
        <button onClick={() => setScreen("home")} style={{ alignSelf: "flex-start" }}>
          ‹ Zurück
        </button>
        <h1 style={{ fontSize: 22 }}>Neuer Athlet</h1>
        <label style={labelStyle}>
          Name
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="z.B. Lena M."
            style={inputStyle}
            autoFocus
          />
        </label>
        <label style={labelStyle}>
          Körpergrösse in cm (für Meter-Angaben wie Schrittlänge)
          <input
            value={newHeight}
            onChange={(e) => setNewHeight(e.target.value)}
            placeholder="z.B. 175"
            inputMode="numeric"
            style={inputStyle}
          />
        </label>
        <button className="primary" onClick={createAthlete} disabled={!newName.trim()}>
          Athlet anlegen
        </button>
      </main>
    );
  }

  return (
    <main style={screenStyle}>
      <h1 style={{ fontSize: 28 }}>TrackCoach</h1>
      <p style={{ color: "#9aa0a6", fontSize: 14 }}>
        Dein KI-Assistent für Leichtathletik-Training.
      </p>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 16, color: "#c6cad2" }}>Athleten</h2>
        {athletes.length === 0 && (
          <p style={{ color: "#9aa0a6", fontSize: 14 }}>
            Noch keine Athleten. Lege deine Trainingsgruppe an – die App merkt
            sich pro Athlet die Analysen und zeigt Fortschritt und Schwachstellen.
            Alles bleibt lokal auf deinem Gerät.
          </p>
        )}
        {athletes.map((athlete) => (
          <button
            key={athlete.id}
            onClick={() => {
              setCurrentAthlete(athlete);
              setScreen("athlete");
            }}
            style={{ textAlign: "left", display: "flex", justifyContent: "space-between" }}
          >
            <span>🏃 {athlete.name}</span>
            <span style={{ color: "#9aa0a6", fontSize: 13 }}>
              {athlete.heightCm ? `${athlete.heightCm} cm` : ""} ›
            </span>
          </button>
        ))}
        <button onClick={() => setScreen("newAthlete")}>＋ Athlet anlegen</button>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 16, color: "#c6cad2" }}>Schnellanalyse (ohne Athlet)</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? "primary" : undefined}
              onClick={() => setMode(m)}
              style={{ flex: 1 }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ flex: 1 }} onClick={() => startCapture("camera", mode)}>
            📹 Aufnehmen
          </button>
          <button style={{ flex: 1 }} onClick={() => startCapture("gallery", mode)}>
            🖼️ Aus Galerie
          </button>
        </div>
      </section>

      <p style={{ color: "#5f6368", fontSize: 12 }}>
        Alles läuft lokal auf dem Gerät – kein Upload, keine Cloud.
      </p>
      {hiddenFileInput}
    </main>
  );
}

const screenStyle: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  padding: 24,
  maxWidth: 520,
  margin: "0 auto",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 14,
  color: "#c6cad2",
};

const inputStyle: React.CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "#1a1d24",
  border: "1px solid #3c4250",
  borderRadius: 8,
  padding: "10px 12px",
};
