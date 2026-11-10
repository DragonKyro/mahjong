import { create } from 'zustand';
import { freshSeed } from '@/core/rng';
import { judge, makePuzzle, type Puzzle, type PuzzleLevel } from '@/core/training';
import type { Kind } from '@/core/tiles';

interface Progress {
  played: number;
  best: number;
  streak: number;
  bestStreak: number;
}

interface TrainingStore {
  level: PuzzleLevel;
  puzzle: Puzzle;
  guess: Kind | null;
  progress: Progress;
  setLevel: (level: PuzzleLevel) => void;
  answer: (kind: Kind) => void;
  next: () => void;
  reset: () => void;
}

const KEY = 'mahjong.training.v2';
const EMPTY: Progress = { played: 0, best: 0, streak: 0, bestStreak: 0 };

function load(): { level: PuzzleLevel; progress: Progress } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { level?: PuzzleLevel; progress?: Progress } | null;
    return { level: v?.level ?? 'mid', progress: { ...EMPTY, ...v?.progress } };
  } catch {
    return { level: 'mid', progress: EMPTY };
  }
}

function save(level: PuzzleLevel, progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ level, progress }));
  } catch {
    /* storage unavailable */
  }
}

const initial = load();

export const useTraining = create<TrainingStore>((set, get) => ({
  level: initial.level,
  puzzle: makePuzzle(freshSeed(), initial.level),
  guess: null,
  progress: initial.progress,
  setLevel: (level) => {
    save(level, get().progress);
    set({ level, puzzle: makePuzzle(freshSeed(), level), guess: null });
  },
  answer: (kind) => {
    const { guess, puzzle, progress, level } = get();
    if (guess !== null) return;
    const { verdict } = judge(puzzle, kind);
    const ok = verdict === 'best';
    const streak = ok ? progress.streak + 1 : 0;
    const next: Progress = {
      played: progress.played + 1,
      best: progress.best + (ok ? 1 : 0),
      streak,
      bestStreak: Math.max(progress.bestStreak, streak),
    };
    save(level, next);
    set({ guess: kind, progress: next });
  },
  next: () => set({ puzzle: makePuzzle(freshSeed(), get().level), guess: null }),
  reset: () => {
    save(get().level, EMPTY);
    set({ progress: EMPTY });
  },
}));
