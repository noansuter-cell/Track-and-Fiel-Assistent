import { JOINT_LABELS, type Mode, type ScoredJoint } from "./metrics";

/** All data stays on the device (localStorage) — no uploads, no accounts. */

export interface Athlete {
  id: string;
  name: string;
  heightCm: number | null;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  athleteId: string;
  dateISO: string;
  mode: Mode;
  cadenceStepsPerSec: number | null;
  meanTorsoLeanDeg: number | null;
  /** Average score per joint over the whole clip. */
  jointAvgScores: Partial<Record<ScoredJoint, number>>;
  stepLengthsM: number[];
  flightHeightM: number | null;
  takeoffAngleDeg: number | null;
  /** Small JPEG data URL from the analyzed video. */
  thumbnail?: string | null;
}

const ATHLETES_KEY = "trackcoach.athletes.v1";
const RECORDS_KEY = "trackcoach.records.v1";
const DEFAULT_HEIGHT_KEY = "trackcoach.defaultHeightCm.v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/blocked — the app still works, history just isn't kept.
  }
}

export function listAthletes(): Athlete[] {
  return read<Athlete[]>(ATHLETES_KEY, []);
}

export function saveAthlete(athlete: Athlete): void {
  const all = listAthletes().filter((a) => a.id !== athlete.id);
  all.push(athlete);
  all.sort((a, b) => a.name.localeCompare(b.name, "de"));
  write(ATHLETES_KEY, all);
}

export function deleteAthlete(id: string): void {
  write(ATHLETES_KEY, listAthletes().filter((a) => a.id !== id));
  write(RECORDS_KEY, allRecords().filter((r) => r.athleteId !== id));
}

export function newAthlete(name: string, heightCm: number | null): Athlete {
  return {
    id: `ath_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    heightCm,
    createdAt: new Date().toISOString(),
  };
}

export function listAllRecords(): SessionRecord[] {
  return allRecords().sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

function allRecords(): SessionRecord[] {
  return read<SessionRecord[]>(RECORDS_KEY, []);
}

export function listRecords(athleteId: string): SessionRecord[] {
  return allRecords()
    .filter((r) => r.athleteId === athleteId)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

export function addRecord(record: SessionRecord): void {
  const all = allRecords();
  all.push(record);
  write(RECORDS_KEY, all);
}

export function getDefaultHeightCm(): number | null {
  return read<number | null>(DEFAULT_HEIGHT_KEY, null);
}

export function setDefaultHeightCm(heightCm: number | null): void {
  write(DEFAULT_HEIGHT_KEY, heightCm);
}

export interface WeaknessSummary {
  joint: ScoredJoint;
  label: string;
  avgScore: number;
  trendDelta: number | null;
}

/**
 * Weakest metrics across an athlete's sessions plus their trend
 * (average of the last 2 sessions minus average of the first 2).
 */
export function summarizeWeaknesses(records: SessionRecord[]): WeaknessSummary[] {
  if (records.length === 0) return [];
  const joints = new Map<ScoredJoint, number[]>();
  for (const record of records) {
    for (const [joint, score] of Object.entries(record.jointAvgScores)) {
      if (score === undefined) continue;
      const list = joints.get(joint as ScoredJoint) ?? [];
      list.push(score);
      joints.set(joint as ScoredJoint, list);
    }
  }
  const summaries: WeaknessSummary[] = [];
  for (const [joint, scores] of joints) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    let trendDelta: number | null = null;
    if (scores.length >= 3) {
      const first = scores.slice(0, 2);
      const last = scores.slice(-2);
      trendDelta =
        last.reduce((a, b) => a + b, 0) / last.length -
        first.reduce((a, b) => a + b, 0) / first.length;
    }
    summaries.push({ joint, label: JOINT_LABELS[joint], avgScore: avg, trendDelta });
  }
  return summaries.sort((a, b) => a.avgScore - b.avgScore);
}
