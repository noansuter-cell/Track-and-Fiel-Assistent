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
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      {error ? (
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
          }}
        >
          <p style={{ color: "#f28b82", marginBottom: 14 }}>{error}</p>
          <button className="primary" onClick={onCancel}>Zurück</button>
        </div>
      ) : (
        <video
          ref={previewRef}
          muted
          playsInline
          autoPlay
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          top: "max(14px, env(safe-area-inset-top))",
          left: 14,
          right: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button className="glass chip" onClick={onCancel}>‹ Zurück</button>
        <span
          className="glass chip num"
          style={{ color: recording ? "#ff6369" : "var(--text-2)" }}
        >
          {recording ? `● REC ${elapsedSec}s` : "Bereit"}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "max(24px, env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        {!error && (
          <button
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Aufnahme stoppen" : "Aufnahme starten"}
            style={{
              width: 74,
              height: 74,
              borderRadius: "50%",
              border: "4px solid rgba(255,255,255,0.85)",
              background: "transparent",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                display: "block",
                width: recording ? 28 : 56,
                height: recording ? 28 : 56,
                borderRadius: recording ? 8 : "50%",
                background: "#e5484d",
                transition: "all 200ms cubic-bezier(0.32, 0.72, 0, 1)",
              }}
            />
          </button>
        )}
        <p className="glass chip" style={{ color: "var(--text-2)", fontSize: 12 }}>
          Seitlich filmen · ganzer Körper im Bild · ruhig halten
        </p>
      </div>
    </div>
  );
}
