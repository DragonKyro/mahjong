import { create } from 'zustand';
import type { Tile } from '@core/tiles/Tile';
import { PuzzleGenerator, type Puzzle } from '@training/PuzzleGenerator';

const PROGRESS_KEY = 'mahjong.training.progress.v1';

export interface TrainingProgress {
  total: number;
  correct: number;
  currentStreak: number;
  bestStreak: number;
}

function loadProgress(): TrainingProgress {
  if (typeof localStorage === 'undefined') {
    return { total: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
  }
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { total: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
    const parsed = JSON.parse(raw) as Partial<TrainingProgress>;
    return {
      total: parsed.total ?? 0,
      correct: parsed.correct ?? 0,
      currentStreak: parsed.currentStreak ?? 0,
      bestStreak: parsed.bestStreak ?? 0,
    };
  } catch {
    return { total: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
  }
}

function saveProgress(p: TrainingProgress): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // Quota exceeded / private mode — silently ignore.
  }
}

interface TrainingStore {
  puzzle: Puzzle | null;
  /** The tile the user picked, or null if they haven't picked yet. */
  guess: Tile | null;
  /** True once the user has picked — reveals the analysis. */
  revealed: boolean;
  progress: TrainingProgress;

  newPuzzle: () => void;
  submitGuess: (tile: Tile) => void;
  resetProgress: () => void;
}

export const useTrainingStore = create<TrainingStore>((set, get) => ({
  puzzle: null,
  guess: null,
  revealed: false,
  progress: loadProgress(),

  newPuzzle: () => {
    set({ puzzle: PuzzleGenerator.generate(), guess: null, revealed: false });
  },

  submitGuess: (tile) => {
    const puzzle = get().puzzle;
    if (!puzzle || get().revealed) return;
    const correct = puzzle.optimal.discard.equals(tile);
    const prev = get().progress;
    const nextStreak = correct ? prev.currentStreak + 1 : 0;
    const progress: TrainingProgress = {
      total: prev.total + 1,
      correct: prev.correct + (correct ? 1 : 0),
      currentStreak: nextStreak,
      bestStreak: Math.max(prev.bestStreak, nextStreak),
    };
    saveProgress(progress);
    set({ guess: tile, revealed: true, progress });
  },

  resetProgress: () => {
    const blank: TrainingProgress = { total: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
    saveProgress(blank);
    set({ progress: blank });
  },
}));
