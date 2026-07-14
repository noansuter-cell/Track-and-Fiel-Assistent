"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listAllRecords,
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

type Tab = "home" | "tracking" | "athletes";
type Overlay = "none" | "record" | "analyze" | "newAthlete" | "athleteDetail";

export default function TrackCoachApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [detailAthlete, setDetailAthlete] = useState<Athlete | null>(null);
  const [mode, setMode] = useState<Mode>("sprint");
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [newHeight, setNewHeight] = useState("");

  const refresh = useCallback(() => setAthletes(listAthletes()), []);

  useEffect(() => {
    refresh();
    // Warm the model download/compile while the user is still navigating.
    void getPoseLandmarker().catch(() => undefined);
  }, [refresh]);

  const assignedAthlete = athletes.find((a) => a.id === assignedId) ?? null;

  const openVideo = useCallback((blob: Blob) => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setOverlay("analyze");
  }, []);

  const closeVideo = useCallback(() => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    refresh();
    setOverlay(detailAthlete ? "athleteDetail" : "none");
  }, [detailAthlete, refresh]);

  const startCapture = (source: "camera" | "gallery") => {
    if (source === "camera") setOverlay("record");
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
    refresh();
    setNewName("");
    setNewHeight("");
    setDetailAthlete(athlete);
    setOverlay("athleteDetail");
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

  // --- Fullscreen overlays (no tab bar) ---
  if (overlay === "record") {
    return (
      <VideoRecorder
        onRecorded={openVideo}
        onCancel={() => setOverlay(detailAthlete ? "athleteDetail" : "none")}
      />
    );
  }
  if (overlay === "analyze" && videoUrl) {
    return (
      <>
        <VideoAnalysis
          videoUrl={videoUrl}
          mode={mode}
          athlete={detailAthlete ?? assignedAthlete}
          onAthleteUpdated={refresh}
          onBack={closeVideo}
        />
        {hiddenFileInput}
      </>
    );
  }
  if (overlay === "athleteDetail" && detailAthlete) {
    return (
      <>
        <AthleteDetail
          athlete={detailAthlete}
          onStart={(source, m) => {
            setMode(m);
            startCapture(source);
          }}
          onBack={() => {
            setDetailAthlete(null);
            refresh();
            setOverlay("none");
            setTab("athletes");
          }}
        />
        {hiddenFileInput}
      </>
    );
  }
  if (overlay === "newAthlete") {
    return (
      <main style={pageStyle} className="fade-in">
        <button className="ghost-btn" onClick={() => setOverlay("none")} style={{ alignSelf: "flex-start" }}>
          ‹ Zurück
        </button>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Neuer Athlet</h1>
        <label style={labelStyle}>
          Name
          <input
            className="field"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="z.B. Lena M."
            autoFocus
          />
        </label>
        <label style={labelStyle}>
          Körpergrösse in cm — für Meter-Angaben wie Schrittlänge
          <input
            className="field"
            value={newHeight}
            onChange={(e) => setNewHeight(e.target.value)}
            placeholder="z.B. 175"
            inputMode="numeric"
          />
        </label>
        <button className="primary" onClick={createAthlete} disabled={!newName.trim()}>
          Athlet anlegen
        </button>
      </main>
    );
  }

  // --- Tab pages ---
  return (
    <>
      <main style={pageStyle} className="fade-in" key={tab}>
        {tab === "home" && (
          <HomeTab
            athletes={athletes}
            onTrack={() => setTab("tracking")}
            onOpenAthlete={(a) => {
              setDetailAthlete(a);
              setOverlay("athleteDetail");
            }}
          />
        )}
        {tab === "tracking" && (
          <TrackingTab
            athletes={athletes}
            mode={mode}
            setMode={setMode}
            assignedId={assignedId}
            setAssignedId={setAssignedId}
            onStart={startCapture}
          />
        )}
        {tab === "athletes" && (
          <AthletesTab
            athletes={athletes}
            onOpen={(a) => {
              setDetailAthlete(a);
              setOverlay("athleteDetail");
            }}
            onNew={() => setOverlay("newAthlete")}
          />
        )}
        <div style={{ height: 84 }} />
      </main>

      <nav className="tabbar glass" aria-label="Hauptnavigation">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          Home
        </button>
        <button className={tab === "tracking" ? "active" : ""} onClick={() => setTab("tracking")}>
          Tracking
        </button>
        <button className={tab === "athletes" ? "active" : ""} onClick={() => setTab("athletes")}>
          Athleten
        </button>
      </nav>
      {hiddenFileInput}
    </>
  );
}

function HomeTab({
  athletes,
  onTrack,
  onOpenAthlete,
}: {
  athletes: Athlete[];
  onTrack: () => void;
  onOpenAthlete: (a: Athlete) => void;
}) {
  const records = listAllRecords();
  const nameOf = (id: string) => athletes.find((a) => a.id === id)?.name ?? "Schnellanalyse";
  return (
    <>
      <header>
        <p style={{ color: "var(--text-2)", fontSize: 14 }}>Willkommen zurück</p>
        <h1 style={{ fontSize: 30, fontWeight: 700 }}>TrackCoach</h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card">
          <p className="num" style={{ fontSize: 28, fontWeight: 700 }}>{athletes.length}</p>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>Athleten</p>
        </div>
        <div className="card">
          <p className="num" style={{ fontSize: 28, fontWeight: 700 }}>{records.length}</p>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>Analysen</p>
        </div>
      </div>

      <button className="primary" style={{ padding: 18, fontSize: 16 }} onClick={onTrack}>
        Neue Analyse starten
      </button>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 16, color: "var(--text-2)", fontWeight: 600 }}>
          Letzte Analysen
        </h2>
        {records.length === 0 && (
          <div className="card" style={{ color: "var(--text-2)", fontSize: 14 }}>
            Noch keine Analysen. Starte über «Tracking» deine erste Aufnahme —
            die Auswertung landet automatisch hier.
          </div>
        )}
        {records.slice(0, 5).map((r) => {
          const athlete = athletes.find((a) => a.id === r.athleteId);
          return (
            <button
              key={r.id}
              className="card"
              style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              onClick={() => athlete && onOpenAthlete(athlete)}
            >
              <span>
                <strong>{nameOf(r.athleteId)}</strong>
                <span style={{ color: "var(--text-2)" }}> · {MODE_LABELS[r.mode]}</span>
              </span>
              <span className="num" style={{ color: "var(--text-3)", fontSize: 13 }}>
                {new Date(r.dateISO).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}
              </span>
            </button>
          );
        })}
      </section>
    </>
  );
}

function TrackingTab({
  athletes,
  mode,
  setMode,
  assignedId,
  setAssignedId,
  onStart,
}: {
  athletes: Athlete[];
  mode: Mode;
  setMode: (m: Mode) => void;
  assignedId: string | null;
  setAssignedId: (id: string | null) => void;
  onStart: (source: "camera" | "gallery") => void;
}) {
  return (
    <>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Tracking</h1>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={sectionTitleStyle}>Disziplin</h2>
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
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={sectionTitleStyle}>Athlet zuweisen</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={`chip ${assignedId === null ? "primary" : ""}`}
            onClick={() => setAssignedId(null)}
          >
            Ohne Athlet
          </button>
          {athletes.map((a) => (
            <button
              key={a.id}
              className={`chip ${assignedId === a.id ? "primary" : ""}`}
              onClick={() => setAssignedId(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button className="card" style={{ padding: 24, textAlign: "center" }} onClick={() => onStart("camera")}>
          <span style={{ fontSize: 30, display: "block", marginBottom: 8 }}>📹</span>
          Aufnehmen
        </button>
        <button className="card" style={{ padding: 24, textAlign: "center" }} onClick={() => onStart("gallery")}>
          <span style={{ fontSize: 30, display: "block", marginBottom: 8 }}>🖼️</span>
          Aus Galerie
        </button>
      </section>

      <p style={{ color: "var(--text-3)", fontSize: 13 }}>
        Seitlich filmen, ganzer Körper im Bild, Kamera ruhig halten. Die Analyse
        läuft komplett auf deinem Gerät.
      </p>
    </>
  );
}

function AthletesTab({
  athletes,
  onOpen,
  onNew,
}: {
  athletes: Athlete[];
  onOpen: (a: Athlete) => void;
  onNew: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Athleten</h1>
        <button onClick={onNew}>＋ Neu</button>
      </div>
      {athletes.length === 0 && (
        <div className="card" style={{ color: "var(--text-2)", fontSize: 14 }}>
          Lege deine Trainingsgruppe an. Pro Athlet speichert TrackCoach die
          Analysen, den Fortschritt und die Arbeitsschwerpunkte — lokal auf
          diesem Gerät.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {athletes.map((a) => (
          <button
            key={a.id}
            className="card"
            style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => onOpen(a)}
          >
            <strong>{a.name}</strong>
            <span style={{ color: "var(--text-3)", fontSize: 13 }}>
              {a.heightCm ? `${a.heightCm} cm · ` : ""}›
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  padding: "max(24px, env(safe-area-inset-top)) 20px 0",
  maxWidth: 640,
  margin: "0 auto",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-2)",
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 14,
  color: "var(--text-2)",
};
