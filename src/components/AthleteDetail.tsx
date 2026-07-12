"use client";

import { useMemo, useState } from "react";
import {
  listRecords,
  summarizeWeaknesses,
  type Athlete,
} from "@/lib/athletes";
import { MODE_LABELS, scoreColor, type Mode } from "@/lib/metrics";

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
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 24,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onBack}>‹ Athleten</button>
        <span style={{ color: "#9aa0a6", fontSize: 13 }}>
          {athlete.heightCm ? `${athlete.heightCm} cm` : "Grösse fehlt"}
        </span>
      </div>
      <h1 style={{ fontSize: 24 }}>🏃 {athlete.name}</h1>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 15, color: "#c6cad2" }}>Neue Analyse</h2>
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
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 15, color: "#c6cad2" }}>
            Arbeitsschwerpunkte (aus {records.length}{" "}
            {records.length === 1 ? "Analyse" : "Analysen"})
          </h2>
          {weaknesses.slice(0, 3).map((w) => (
            <div
              key={w.joint}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#1a1d24",
                border: "1px solid #2a2f3a",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: scoreColor(w.avgScore),
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{w.label}</span>
              <span style={{ color: "#9aa0a6", fontVariantNumeric: "tabular-nums" }}>
                Ø {w.avgScore.toFixed(0)}
                {w.trendDelta !== null && (
                  <span
                    style={{
                      marginLeft: 6,
                      color:
                        w.trendDelta > 2
                          ? "#22c55e"
                          : w.trendDelta < -2
                            ? "#ef4444"
                            : "#9aa0a6",
                    }}
                  >
                    {w.trendDelta > 2 ? "↗" : w.trendDelta < -2 ? "↘" : "→"}
                  </span>
                )}
              </span>
            </div>
          ))}
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 15, color: "#c6cad2" }}>Verlauf</h2>
        {records.length === 0 && (
          <p style={{ color: "#9aa0a6", fontSize: 14 }}>
            Noch keine Analysen. Nimm die erste Übung auf – die Auswertung wird
            hier automatisch gespeichert.
          </p>
        )}
        {[...records].reverse().map((r) => (
          <div
            key={r.id}
            style={{
              background: "#1a1d24",
              border: "1px solid #2a2f3a",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 13,
              color: "#c6cad2",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{MODE_LABELS[r.mode]}</strong>
              <span style={{ color: "#9aa0a6" }}>
                {new Date(r.dateISO).toLocaleDateString("de-CH", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <span style={{ color: "#9aa0a6" }}>
              {[
                r.cadenceStepsPerSec !== null
                  ? `Kadenz ${r.cadenceStepsPerSec.toFixed(1)}/s`
                  : null,
                r.stepLengthsM.length > 0
                  ? `Ø Schritt ${(
                      r.stepLengthsM.reduce((a, b) => a + b, 0) / r.stepLengthsM.length
                    ).toFixed(2)} m`
                  : null,
                r.flightHeightM !== null ? `Flughöhe ${r.flightHeightM.toFixed(2)} m` : null,
                r.takeoffAngleDeg !== null ? `Absprung ${r.takeoffAngleDeg.toFixed(0)}°` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}
