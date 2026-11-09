// Render smoke tests: every screen mounts, and the table offers the right
// controls in the right moments.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseAction } from '@/core/ai';
import { applyAction, createMatch, pendingSeats, type MatchState } from '@/core/engine';
import { defaultRulesFor, type VariantId } from '@/core/variants';
import { DEFAULT_HK_RULES } from '@/core/variants/hk';
import { useTeacherForHk } from '@/core/nn/teacher';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { App } from './App';

// HK computer players are networks the app loads; tests play HK with the heuristic instead.
useTeacherForHk();

function matchUntil(done: (s: MatchState) => boolean, seed = 12345, variant: VariantId = 'hk'): MatchState {
  let s = createMatch({
    variant,
    rules: defaultRulesFor(variant),
    seed,
    seats: [
      { name: 'You', ai: false },
      { name: 'Wong', ai: true, level: 'normal' },
      { name: 'Chan', ai: true, level: 'hard' },
      { name: 'Lee', ai: true, level: 'easy' },
    ],
  });
  for (let n = 0; n < 20000 && !done(s); n++) s = applyAction(s, chooseAction(s, pendingSeats(s)[0]!)!);
  return s;
}

afterEach(() => {
  cleanup();
  act(() => {
    useGame.setState({ match: null, mode: null, mySeat: null, aiDriver: false });
    useNet.setState({ status: 'idle', lobby: null, code: null });
  });
});

describe('screens', () => {
  it('home lists the variants', () => {
    render(<App />);
    for (const name of ['Hong Kong Old Style', 'Taiwanese 16-tile', 'Japanese Riichi', 'American']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Deal the tiles' })).toBeTruthy();
  });

  it('rules and trainer pages', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getAllByText('清一色').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Train' }));
    expect(screen.getByText('Discard trainer')).toBeTruthy();
  });

  it('the lobby', () => {
    const me = useNet.getState().uuid;
    act(() =>
      useNet.setState({
        status: 'room',
        code: 'K7PX',
        people: [{ uuid: me, name: 'Kyle' }],
        lobby: {
          hostUuid: me,
          seats: [{ kind: 'human', uuid: me, name: 'Kyle' }, { kind: 'ai', level: 'hard', name: 'Chan' }, { kind: 'open' }, { kind: 'open' }],
          rulesJson: JSON.stringify(DEFAULT_HK_RULES),
          variant: 'riichi',
          match: null,
          matchCount: 0,
        },
      }),
    );
    render(<App />);
    expect(screen.getByText('K7PX')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fill 2 empty seats/ })).toBeTruthy();
  });
});

describe('the table', () => {
  it('on your turn, tiles are discardable', () => {
    const s = matchUntil((x) => x.hand.phase === 'act' && x.hand.turn === 0 && x.seq > 20);
    act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
    render(<App />);
    expect(screen.getByText(/Your turn/)).toBeTruthy();
    const before = useGame.getState().match!.seq;
    const tile = screen.getAllByTitle(/^Discard/)[0]!;
    fireEvent.click(tile);
    expect(useGame.getState().match!.seq).toBe(before + 1);
  });

  it('offers claims with a pass button', () => {
    const s = matchUntil((x) => x.hand.phase === 'claim' && x.hand.claim!.responses[0] === null && x.hand.claim!.options[0]!.length > 0);
    act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Pass/ }));
    expect(useGame.getState().match!.hand.claim?.responses[0] ?? { type: 'pass' }).toEqual({ type: 'pass' });
  });

  it('shows the hand result and moves on', () => {
    const s = matchUntil((x) => x.hand.phase === 'end');
    act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Hand result' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next hand|Final results/ }));
    expect(useGame.getState().match!.hand.ready[0]).toBe(true);
  });

  it('match over', () => {
    const s = matchUntil((x) => x.over);
    act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
    render(<App />);
    expect(screen.getByText('Match over')).toBeTruthy();
  });

  it.each(['taiwan', 'riichi', 'american'] as const)('%s: a turn, a claim and a hand result render', (variant) => {
    for (const done of [
      (x: MatchState) => x.hand.phase === 'act' && x.hand.turn === 0 && x.seq > 30,
      (x: MatchState) => x.hand.phase === 'claim' && x.hand.claim!.responses[0] === null && x.hand.claim!.options[0]!.length > 0,
      (x: MatchState) => x.hand.phase === 'end',
    ]) {
      const s = matchUntil(done, 777, variant);
      act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
      const { unmount } = render(<App />);
      expect(document.querySelector('.board')).toBeTruthy();
      unmount();
    }
  });

  it('american: the Charleston asks for three tiles', () => {
    const s = matchUntil((x) => x.hand.phase === 'charleston', 5, 'american');
    act(() => useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: false }));
    render(<App />);
    expect(screen.getByText(/pick 3 tiles to pass right/)).toBeTruthy();
    const tiles = screen.getAllByTitle(/^Pass /).slice(0, 3);
    tiles.forEach((t) => fireEvent.click(t));
    fireEvent.click(screen.getByRole('button', { name: /Pass right/ }));
    expect(useGame.getState().match!.hand.charleston!.picks[0]).toHaveLength(3);
  });

  it('rules page has a tab per variant', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    fireEvent.click(screen.getByRole('button', { name: /Japanese Riichi/ }));
    expect(screen.getAllByText('平和').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /American/ }));
    expect(screen.getByText('House Card 2026')).toBeTruthy();
  });
});
