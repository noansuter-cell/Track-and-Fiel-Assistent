"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onRecorded: (blob: Blob) => void;
  onCancel: () => void;
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export default function VideoRecorder({ onRecorded, onCancel }: Props) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          await previewRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setError(
            "Kamera-Zugriff fehlgeschlagen. Bitte Berechtigung erteilen und HTTPS verwenden.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      // Detach before stopping so onstop doesn't treat unmount as a finished take.
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const interval = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );
    return () => clearInterval(interval);
  }, [recording]);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    if (typeof MediaRecorder === "undefined") {
      setError("MediaRecorder wird von diesem Browser nicht unterstützt.");
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      // Only hand the video over if the user pressed stop (recorderRef still set);
      // unmount cleanup also calls stop() but must not navigate.
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
        onRecorded(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      }
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setElapsedSec(0);
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    recorderRef.current?.stop();
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onCancel}>‹ Zurück</button>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {recording ? `● REC ${elapsedSec}s` : "Bereit"}
        </span>
      </div>

      {error ? (
        <p style={{ color: "#f28b82", padding: 16 }}>{error}</p>
      ) : (
        <video
          ref={previewRef}
          muted
          playsInline
          autoPlay
          style={{
            width: "100%",
            maxHeight: "70dvh",
            background: "#000",
            borderRadius: 8,
            objectFit: "contain",
          }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
        {recording ? (
          <button className="danger" style={{ width: 240 }} onClick={stopRecording}>
            ⏹ Aufnahme stoppen
          </button>
        ) : (
          <button
            className="primary"
            style={{ width: 240 }}
            onClick={startRecording}
            disabled={!!error}
          >
            ⏺ Aufnahme starten
          </button>
        )}
      </div>
      <p style={{ color: "#5f6368", fontSize: 12, textAlign: "center" }}>
        Tipp: seitlich filmen, ganzer Körper im Bild, Handy ruhig halten.
      </p>
    </main>
  );
}
