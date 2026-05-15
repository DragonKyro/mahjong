import { describe, it, expect } from 'vitest';
import { HonorTile, Wind, Dragon } from './HonorTile';
import { SuitTile, Suit } from './SuitTile';

describe('HonorTile', () => {
  it('toString returns the enum letter code', () => {
    expect(new HonorTile(Wind.East).toString()).toBe('E');
    expect(new HonorTile(Dragon.Red).toString()).toBe('C');
    expect(new HonorTile(Dragon.White).toString()).toBe('P');
  });

  it('renders the correct unicode glyphs', () => {
    expect(new HonorTile(Wind.East).toUnicode()).toBe('🀀');
    expect(new HonorTile(Wind.South).toUnicode()).toBe('🀁');
    expect(new HonorTile(Wind.West).toUnicode()).toBe('🀂');
    expect(new HonorTile(Wind.North).toUnicode()).toBe('🀃');
    expect(new HonorTile(Dragon.Red).toUnicode()).toBe('🀄');
    expect(new HonorTile(Dragon.Green).toUnicode()).toBe('🀅');
    expect(new HonorTile(Dragon.White).toUnicode()).toBe('🀆');
  });

  it('equals same honor only', () => {
    expect(new HonorTile(Wind.East).equals(new HonorTile(Wind.East))).toBe(true);
    expect(new HonorTile(Wind.East).equals(new HonorTile(Wind.South))).toBe(false);
    expect(new HonorTile(Dragon.Red).equals(new HonorTile(Dragon.Green))).toBe(false);
    expect(new HonorTile(Dragon.Red).equals(new SuitTile(Suit.Character, 1))).toBe(false);
  });

  it('sort key orders winds (27-30) before dragons (31-33), all after suits', () => {
    expect(new HonorTile(Wind.East).sortKey()).toBe(27);
    expect(new HonorTile(Wind.North).sortKey()).toBe(30);
    expect(new HonorTile(Dragon.Red).sortKey()).toBe(31);
    expect(new HonorTile(Dragon.White).sortKey()).toBe(33);
    expect(new HonorTile(Wind.North).compareTo(new HonorTile(Dragon.Red))).toBeLessThan(0);
  });

  it('isWind and isDragon partition honors', () => {
    for (const w of [Wind.East, Wind.South, Wind.West, Wind.North]) {
      const t = new HonorTile(w);
      expect(t.isWind()).toBe(true);
      expect(t.isDragon()).toBe(false);
    }
    for (const d of [Dragon.Red, Dragon.Green, Dragon.White]) {
      const t = new HonorTile(d);
      expect(t.isWind()).toBe(false);
      expect(t.isDragon()).toBe(true);
    }
  });

  it('counts as terminal-or-honor for chi-formation rules', () => {
    expect(new HonorTile(Wind.East).isTerminalOrHonor()).toBe(true);
    expect(new HonorTile(Dragon.Red).isTerminalOrHonor()).toBe(true);
  });
});
