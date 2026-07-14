"use client";

import { useMemo, useState } from "react";
import { listRecords, summarizeWeaknesses, type Athlete } from "@/lib/athletes";
import { MODE_LABELS, scoreColor, type Mode } from "@/lib/metrics";
import Avatar from "./Avatar";

interface Props {
  athlete: Athlete;
  onStart: (source: "camera" | "gallery", mode: Mode) => void;
  onBack: () => void;
}

export default function AthleteDetail({ athlete, onStart, onBack }: Props) {
  const [mode, setMode] = useState<Mode>("sprint");
  const records = useMemo(() => listRecords(athlete.id), [athlete.id]);
  const weaknesses = useMemo(() => summarizeWeaknesses(records), [records]);

  return (
    <main
      className="fade-in"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "max(24px, env(safe-area-inset-top)) 20px 32px",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="ghost-btn" onClick={onBack}>‹ Athleten</button>
        <span className="num" style={{ color: "var(--text-3)", fontSize: 13 }}>
          {athlete.heightCm ? `${athlete.heightCm} cm` : ""}
        </span>
      </div>

      <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={athlete.name} size={58} />
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>{athlete.name}</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14 }}>
            {records.length === 0
              ? "Noch keine Analysen"
              : `${records.length} ${records.length === 1 ? "Analyse" : "Analysen"}`}
          </p>
        </div>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
          <button style={{ flex: 1 }} onClick={() => onStart("camera", mode)}>
            📹 Aufnehmen
          </button>
          <button style={{ flex: 1 }} onClick={() => onStart("gallery", mode)}>
            🖼️ Aus Galerie
          </button>
        </div>
      </section>

      {weaknesses.length > 0 && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Technik-Profil</h2>
          {weaknesses.map((w) => (
            <div key={w.joint} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{w.label}</span>
                <span className="num" style={{ color: "var(--text-2)" }}>
                  {w.avgScore.toFixed(0)}
                  {w.trendDelta !== null && (
                    <span
                      style={{
                        marginLeft: 6,
                        color:
                          w.trendDelta > 2
                            ? "#22c55e"
                            : w.trendDelta < -2
                              ? "#ef4444"
                              : "var(--text-3)",
                      }}
                    >
                      {w.trendDelta > 2 ? "↗" : w.trendDelta < -2 ? "↘" : "→"}
                    </span>
                  )}
                </span>
              </div>
              <div className="meter">
                <div
                  style={{ width: `${w.avgScore}%`, background: scoreColor(w.avgScore) }}
                />
              </div>
            </div>
          ))}
          <p style={{ color: "var(--text-3)", fontSize: 12 }}>
            Durchschnitt über alle Analysen · Pfeil = Entwicklung seit den ersten
            Aufnahmen
          </p>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 15, color: "var(--text-2)", fontWeight: 600 }}>Verlauf</h2>
        {records.length === 0 && (
          <div className="card" style={{ color: "var(--text-2)", fontSize: 14 }}>
            Nimm die erste Übung auf — die Auswertung wird hier automatisch
            gespeichert und der Fortschritt sichtbar.
          </div>
        )}
        {[...records].reverse().map((r, i) => (
          <div
            key={r.id}
            className="card rise"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, ["--i" as never]: i }}
          >
            {r.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={r.thumbnail} alt="" />
            )}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <strong>{MODE_LABELS[r.mode]}</strong>
                <span className="num" style={{ color: "var(--text-3)", fontSize: 13 }}>
                  {new Date(r.dateISO).toLocaleDateString("de-CH", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <span className="num" style={{ color: "var(--text-2)", fontSize: 13 }}>
                {[
                  r.cadenceStepsPerSec !== null ? `Kadenz ${r.cadenceStepsPerSec.toFixed(1)}/s` : null,
                  r.stepLengthsM.length > 0
                    ? `Ø Schritt ${(r.stepLengthsM.reduce((a, b) => a + b, 0) / r.stepLengthsM.length).toFixed(2)} m`
                    : null,
                  r.flightHeightM !== null ? `Flughöhe ${r.flightHeightM.toFixed(2)} m` : null,
                  r.takeoffAngleDeg !== null ? `Absprung ${r.takeoffAngleDeg.toFixed(0)}°` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Keine Messwerte"}
              </span>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
