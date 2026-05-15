import { describe, it, expect } from 'vitest';
import { BonusTile } from './BonusTile';
import { HonorTile, Wind } from './HonorTile';

describe('BonusTile', () => {
  it('toString tags flowers as F and seasons as S, with index', () => {
    expect(new BonusTile('flower', 1).toString()).toBe('F1');
    expect(new BonusTile('flower', 4).toString()).toBe('F4');
    expect(new BonusTile('season', 1).toString()).toBe('S1');
    expect(new BonusTile('season', 4).toString()).toBe('S4');
  });

  it('exposes human-readable names', () => {
    expect(new BonusTile('flower', 1).name()).toBe('Plum');
    expect(new BonusTile('flower', 4).name()).toBe('Bamboo');
    expect(new BonusTile('season', 1).name()).toBe('Spring');
    expect(new BonusTile('season', 4).name()).toBe('Winter');
  });

  it('renders the correct unicode glyphs', () => {
    expect(new BonusTile('flower', 1).toUnicode()).toBe('🀢');
    expect(new BonusTile('flower', 4).toUnicode()).toBe('🀥');
    expect(new BonusTile('season', 1).toUnicode()).toBe('🀦');
    expect(new BonusTile('season', 4).toUnicode()).toBe('🀩');
  });

  it('equals same category and index only', () => {
    expect(new BonusTile('flower', 2).equals(new BonusTile('flower', 2))).toBe(true);
    expect(new BonusTile('flower', 2).equals(new BonusTile('flower', 3))).toBe(false);
    expect(new BonusTile('flower', 2).equals(new BonusTile('season', 2))).toBe(false);
    expect(new BonusTile('flower', 2).equals(new HonorTile(Wind.East))).toBe(false);
  });

  it('sort key orders bonuses after honors: flowers 34-37, seasons 38-41', () => {
    expect(new BonusTile('flower', 1).sortKey()).toBe(34);
    expect(new BonusTile('flower', 4).sortKey()).toBe(37);
    expect(new BonusTile('season', 1).sortKey()).toBe(38);
    expect(new BonusTile('season', 4).sortKey()).toBe(41);
  });

  it('does NOT count as terminal-or-honor (bonus tiles never sit in the playable hand)', () => {
    expect(new BonusTile('flower', 1).isTerminalOrHonor()).toBe(false);
  });
});
