import { describe, it, expect } from 'vitest';
import { FaanCalculator } from './FaanCalculator';
import { DEFAULT_RULES } from './RulesConfig';
import { HandPatterns } from './HandPatterns';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import type { Tile } from '@core/tiles/Tile';
import type { WinContext } from '@core/game/types';

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const S = () => new HonorTile(Wind.South);
const W = () => new HonorTile(Wind.West);
const N = () => new HonorTile(Wind.North);
const Red = () => new HonorTile(Dragon.Red);
const Green = () => new HonorTile(Dragon.Green);
const White = () => new HonorTile(Dragon.White);

const defaultContext: WinContext = {
  winnerSeat: Wind.East,
  prevailingWind: Wind.East,
  fromSeat: Wind.South,
  fromKongReplacement: false,
  fromKongRob: false,
  fromLastTile: false,
  bonusTiles: [],
};

function calc(): FaanCalculator {
  return new FaanCalculator(DEFAULT_RULES);
}

function idsOf(result: { entries: readonly { id: string }[] }): string[] {
  return result.entries.map((e) => e.id);
}

describe('FaanCalculator — hand shapes', () => {
  it('scores 平和 (All Sequences) on a hand of 4 chi + non-value pair', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      p(5),
    ];
    const result = calc().calculate(concealed, p(5), [], defaultContext);
    expect(idsOf(result)).toContain('all-chi');
  });

  it('scores 對對和 (All Triplets)', () => {
    const concealed: Tile[] = [
      m(2), m(2), m(2),
      p(5), p(5), p(5),
      s(7), s(7), s(7),
      Red(), Red(), Red(),
      E(),
    ];
    const result = calc().calculate(concealed, E(), [], defaultContext);
    expect(idsOf(result)).toContain('all-triplets');
  });

  it('scores 清一色 (Full Flush) when all tiles share one suit and no honors', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      m(2), m(3), m(4),
      m(5), m(6), m(7),
      m(7), m(8), m(9),
      m(5),
    ];
    const result = calc().calculate(concealed, m(5), [], defaultContext);
    expect(idsOf(result)).toContain('full-flush');
    expect(idsOf(result)).not.toContain('half-flush');
  });

  it('scores 混一色 (Half Flush): one suit + honors', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      m(7), m(8), m(9),
      E(), E(), E(),
      Red(),
    ];
    const result = calc().calculate(concealed, Red(), [], defaultContext);
    expect(idsOf(result)).toContain('half-flush');
  });

  it('scores 大三元 as a limit hand (all 3 dragon pongs)', () => {
    const concealed: Tile[] = [
      Red(), Red(), Red(),
      Green(), Green(), Green(),
      White(), White(), White(),
      m(2), m(3), m(4),
      E(),
    ];
    const result = calc().calculate(concealed, E(), [], defaultContext);
    expect(result.isLimit).toBe(true);
    expect(result.total).toBe(DEFAULT_RULES.limitFaan);
    expect(idsOf(result)).toContain('big-three-dragons');
  });

  it('scores 小三元 (Small Three Dragons): 2 dragon pongs + dragon pair', () => {
    // White stays as the pair; winning tile completes the p7 pong, leaving the
    // small-three-dragons shape intact.
    const concealed: Tile[] = [
      Red(), Red(), Red(),
      Green(), Green(), Green(),
      White(), White(),
      m(1), m(2), m(3),
      p(7), p(7),
    ];
    const result = calc().calculate(concealed, p(7), [], defaultContext);
    expect(idsOf(result)).toContain('small-three-dragons');
  });

  it('scores 大四喜 as a limit hand (all 4 wind pongs)', () => {
    const concealed: Tile[] = [
      E(), E(), E(),
      S(), S(), S(),
      W(), W(), W(),
      N(), N(), N(),
      Red(),
    ];
    const result = calc().calculate(concealed, Red(), [], defaultContext);
    expect(result.isLimit).toBe(true);
    expect(idsOf(result)).toContain('big-four-winds');
  });
});

describe('FaanCalculator — situational faan', () => {
  it('adds 自摸 (self-draw) when fromSeat is null', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(), E(),
      Red(),
    ];
    const ctx: WinContext = { ...defaultContext, fromSeat: null };
    const result = calc().calculate(concealed, Red(), [], ctx);
    expect(idsOf(result)).toContain('self-draw');
  });

  it('adds 嶺上開花 when fromKongReplacement is true', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(), E(),
      Red(),
    ];
    const ctx: WinContext = { ...defaultContext, fromSeat: null, fromKongReplacement: true };
    const result = calc().calculate(concealed, Red(), [], ctx);
    expect(idsOf(result)).toContain('kong-replacement');
  });

  it('adds 河底撈魚 for last-tile discard win', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(), E(),
      Red(),
    ];
    const ctx: WinContext = { ...defaultContext, fromLastTile: true };
    const result = calc().calculate(concealed, Red(), [], ctx);
    expect(idsOf(result)).toContain('last-tile');
  });
});

describe('FaanCalculator — special hands', () => {
  it('scores 七對 (Seven Pairs)', () => {
    const concealed: Tile[] = [
      m(1), m(1),
      m(5), m(5),
      p(3), p(3),
      p(9), p(9),
      s(2), s(2),
      s(8), s(8),
      E(),
    ];
    const result = calc().calculate(concealed, E(), [], defaultContext);
    expect(idsOf(result)).toContain('seven-pairs');
  });

  it('scores 十三么 (Thirteen Orphans) as limit', () => {
    const concealed: Tile[] = [
      m(1), m(9),
      p(1), p(9),
      s(1), s(9),
      E(), S(), W(), N(),
      Red(), Green(), White(),
    ];
    const result = calc().calculate(concealed, m(1), [], defaultContext);
    expect(idsOf(result)).toContain('thirteen-orphans');
    expect(result.isLimit).toBe(true);
  });
});

describe('FaanCalculator — set-specific', () => {
  it('adds 1 faan per 中發白 pong', () => {
    const decomp = HandPatterns.findStandardDecompositions(
      [Red(), Red(), m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(2), p(2)],
      Red(),
      [],
    );
    expect(decomp.length).toBeGreaterThan(0);
    const result = calc().scoreDecomposition(decomp[0]!, defaultContext);
    expect(idsOf(result)).toContain('dragon-C'); // Dragon.Red = 'C'
  });
});
