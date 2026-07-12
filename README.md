# TrackCoach – KI-Assistent für Leichtathletiktrainer

Video aufnehmen oder aus der Galerie laden → die App erkennt 33 Körperpunkte pro
Frame (BlazePose) und bewertet die Technik:

- **Modi:** Sprint und Weitsprung
- **Farbige Gelenkpunkte** (grün/gelb/orange/rot) nach Technik-Score; Punkt
  antippen → Winkel + Coaching-Feedback
- **Schlüsselmomente** (Bodenkontakte, Kniehub, Absprung/Flugmitte/Landung) als
  Sprungmarken auf der Timeline, frame-genaues Scrubbing
- **Messband** für Schrittlänge und Flughöhe (Kalibrierung über Körpergrösse)
- **Athleten-Verwaltung** mit Verlauf und automatischen Arbeitsschwerpunkten
  (lokal gespeichert, keine Cloud)

Alles läuft **client-side im Browser** (MediaPipe PoseLandmarker via WASM/WebGL).
Es werden keine Videos hochgeladen.

## Stack

- Next.js 15 (App Router), TypeScript, React 19
- [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) → `PoseLandmarker` (BlazePose Lite, 33 Landmarks)
- Aufnahme: `getUserMedia` + `MediaRecorder`; Galerie-Import: `<input type="file">`
- Rendering: `<canvas>`-Overlay über dem `<video>`-Element

## Live-Version

Jeder Push auf `main` deployt automatisch nach GitHub Pages
(`.github/workflows/deploy-pages.yml`):

**https://noansuter-cell.github.io/Track-and-Fiel-Assistent/**

## Entwicklung

```bash
npm install
npm run dev
```

Dann `http://localhost:3000` öffnen. (`npm run build` erzeugt einen statischen
Export in `out/` – die App braucht keinen Server.)

**Wichtig fürs Testen auf dem Handy:** Kamera-Zugriff (`getUserMedia`) funktioniert
nur über **HTTPS** (oder `localhost`). Fürs Testen im lokalen Netz z.B. einen
Tunnel verwenden (`npx ngrok http 3000` o.ä.) oder auf Vercel deployen
(`npx vercel`). Der Galerie-Import funktioniert auch ohne Kamera-Zugriff.

## Wie es funktioniert

1. **Analyse-Pass** (`src/lib/analyzeVideo.ts`): Das Video wird einmal komplett
   frame-weise durchlaufen (seek-basiert, 30 Samples/s). Für jeden Frame liefert
   der `PoseLandmarker` (VIDEO-Modus) die 33 Landmarks; alle Ergebnisse werden in
   einem Array gecacht.
2. **Playback & Scrubbing** (`src/components/VideoAnalysis.tsx`): Beim Abspielen
   und Scrubben wird der Skeleton aus dem Cache gezeichnet — keine erneute
   Inferenz, dadurch flüssiges Scrubbing.
3. **Debug-Panel**: Kniewinkel links/rechts (Hüfte–Knie–Knöchel, 2D),
   Erkennungs-Confidence (mittlere Visibility der Körper-Landmarks), Frame-Index.

MediaPipe-WASM-Runtime und das Modell (`pose_landmarker_lite`, ~5 MB) werden beim
ersten Start von CDN geladen und vom Browser gecacht; die Inferenz selbst läuft
vollständig on-device.

## Projektstruktur

```
src/
  app/            Next.js App Router (Layout, Startseite)
  components/
    TrackCoachApp.tsx   Screen-Wechsel: Start / Aufnahme / Analyse
    VideoRecorder.tsx   Kamera-Preview + MediaRecorder
    VideoAnalysis.tsx   Analyse-Fortschritt, Player, Overlay, Scrubbing, Debug-Panel
  lib/
    pose.ts             PoseLandmarker-Singleton (GPU, CPU-Fallback)
    analyzeVideo.ts     Frame-weiser Analyse-Pass mit Landmark-Cache
    drawing.ts          Skeleton-Rendering auf Canvas
    geometry.ts         Winkelberechnung (Kniewinkel), Confidence
    types.ts            Gemeinsame Typen + Landmark-Indizes
```

## Roadmap (nicht Teil von Phase 1)

Metrik-Engine (Kniehub, Kadenz, Hüftstreckung, …), Modi Sprint / Weitsprung /
Hürden, automatische Phasen-Stops, Farb-Scoring der Landmarks, Kalibrierung für
absolute Masse (Schrittlänge, Flughöhe). Siehe Produkt-Spec.
