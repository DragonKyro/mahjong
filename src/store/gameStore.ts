// The engine ↔ UI bridge for a match in progress, solo or online. React reads
// `match` and calls `act`; the store applies the action (solo) or hands it to
// the network layer (online, via the submit hook netStore installs). The AI
// driver below answers for computer seats whenever this device is the one
// that drives them (always in solo; online, see netStore).

import { create } from 'zustand';
import { chooseAction } from '@/core/ai';
import { createMatch, pendingSeats, tryApply, type Action, type AiLevel, type MatchState } from '@/core/engine';
import { freshSeed } from '@/core/rng';
import { defaultRulesFor, normalizeRulesFor, type AnyRules, type VariantId } from '@/core/variants';

export interface SoloSetup {
  variant: VariantId;
  name: string;
  levels: [AiLevel, AiLevel, AiLevel];
  /** House rules per variant (the last ones used for each). */
  rules: Record<VariantId, AnyRules>;
}

const VARIANT_IDS: VariantId[] = ['hk', 'taiwan', 'riichi', 'american'];
const allDefaults = () => Object.fromEntries(VARIANT_IDS.map((v) => [v, defaultRulesFor(v)])) as Record<VariantId, AnyRules>;

export type Speed = 'relaxed' | 'normal' | 'fast';

interface GameStore {
  match: MatchState | null;
  mode: 'solo' | 'online' | null;
  /** The seat this device plays (null = watching). */
  mySeat: number | null;
  /** This device answers for the AI seats. */
  aiDriver: boolean;
  speed: Speed;
  /** Show waits and a suggested discard. */
  hints: boolean;
  notice: string | null;
  soloSetup: SoloSetup;
  startSolo: (setup: SoloSetup) => void;
  /** Ask for a move; false when it isn't legal right now. */
  act: (action: Action) => boolean;
  /** Online: show this state (netStore keeps it in step with the room). */
  showOnline: (match: MatchState | null, mySeat: number | null, aiDriver: boolean) => void;
  setSpeed: (speed: Speed) => void;
  setHints: (on: boolean) => void;
  setNotice: (notice: string | null) => void;
  leave: () => void;
}

const SETUP_KEY = 'mahjong.solo.v2';
const SPEED_KEY = 'mahjong.speed';
const HINT_KEY = 'mahjong.hints';

function loadSetup(): SoloSetup {
  const fallback: SoloSetup = { variant: 'hk', name: 'You', levels: ['normal', 'normal', 'normal'], rules: allDefaults() };
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<SoloSetup>;
    const rules = allDefaults();
    for (const id of VARIANT_IDS) rules[id] = normalizeRulesFor(id, v.rules?.[id]);
    return { variant: v.variant && VARIANT_IDS.includes(v.variant) ? v.variant : 'hk', name: v.name || 'You', levels: v.levels ?? fallback.levels, rules };
  } catch {
    return fallback;
  }
}

function loadSpeed(): Speed {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    return v === 'relaxed' || v === 'fast' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function loadHints(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Installed by netStore while online: routes a move to the room. */
let submitHook: ((action: Action) => boolean) | null = null;
export function setSubmitHook(hook: ((action: Action) => boolean) | null): void {
  submitHook = hook;
}

export const AI_NAMES = ['Wong', 'Chan', 'Lee', 'Cheung', 'Lau', 'Ho'];

export const useGame = create<GameStore>((set, get) => ({
  match: null,
  mode: null,
  mySeat: null,
  aiDriver: false,
  speed: loadSpeed(),
  hints: loadHints(),
  notice: null,
  soloSetup: loadSetup(),

  startSolo: (setup) => {
    store(SETUP_KEY, JSON.stringify(setup));
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const match = createMatch({
      variant: setup.variant,
      rules: setup.rules[setup.variant],
      seed: freshSeed(),
      seats: [
        { name: setup.name.trim() || 'You', ai: false },
        ...setup.levels.map((level, i) => ({ name: names[i]!, ai: true, level })),
      ],
    });
    set({ match, mode: 'solo', mySeat: 0, aiDriver: true, notice: null, soloSetup: setup });
  },

  act: (action) => {
    const { match, mode } = get();
    if (!match) return false;
    if (mode === 'online') return submitHook ? submitHook(action) : false;
    const next = tryApply(match, action);
    if (!next) return false;
    set({ match: next });
    return true;
  },

  showOnline: (match, mySeat, aiDriver) => set({ match, mode: match ? 'online' : null, mySeat, aiDriver }),

  setSpeed: (speed) => {
    store(SPEED_KEY, speed);
    set({ speed });
  },

  setHints: (hints) => {
    store(HINT_KEY, hints ? 'on' : 'off');
    set({ hints });
  },

  setNotice: (notice) => set({ notice }),

  leave: () => set({ match: null, mode: null, mySeat: null, aiDriver: false, notice: null }),
}));

// ------------------------------------------------------------ AI driver

const DELAYS: Record<Speed, { act: number; claim: number; end: number }> = {
  relaxed: { act: 1100, claim: 700, end: 400 },
  normal: { act: 700, claim: 450, end: 250 },
  fast: { act: 280, claim: 160, end: 100 },
};

let timer: ReturnType<typeof setTimeout> | null = null;
let scheduledFor = -1;

function schedule(): void {
  const { match, aiDriver, speed } = useGame.getState();
  if (!match || match.over || !aiDriver) {
    if (timer) clearTimeout(timer);
    timer = null;
    scheduledFor = -1;
    return;
  }
  if (scheduledFor === match.seq && timer) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const seat = pendingSeats(match).find((s) => match.config.seats[s]?.ai);
  if (seat === undefined) return;
  const d = DELAYS[speed];
  const delay = match.hand.phase === 'act' ? d.act : match.hand.phase === 'claim' ? d.claim : d.end;
  const seq = match.seq;
  scheduledFor = seq;
  timer = setTimeout(() => {
    timer = null;
    scheduledFor = -1;
    const now = useGame.getState().match;
    if (!now || now.seq !== seq || !useGame.getState().aiDriver) return schedule();
    const action = chooseAction(now, seat);
    // A move that lands re-schedules through the subscription; otherwise try again.
    if (!action || !useGame.getState().act(action)) schedule();
  }, delay);
}

useGame.subscribe(schedule);
