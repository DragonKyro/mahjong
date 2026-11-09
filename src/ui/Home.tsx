// The start screen: pick a variant, then play the computer or open / join an
// online room.

import { useState } from 'react';
import type { AiLevel } from '@/core/engine';
import { VARIANTS, type VariantId } from '@/core/variants';
import { normalizeRoomCode, roomCodeFromUrl, savedName } from '@/net/room';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { RulesEditor, RulesSummary } from './RulesForms';
import { Tile } from './Tile';

export type Page = 'home' | 'train' | 'rules';

const LEVELS: { id: AiLevel; label: string; blurb: string }[] = [
  { id: 'easy', label: 'Easy', blurb: 'Plays for speed, makes mistakes' },
  { id: 'normal', label: 'Normal', blurb: 'Builds hands that score' },
  { id: 'hard', label: 'Hard', blurb: 'Also defends against ready hands' },
];

// Hong Kong is played by trained neural networks; the levels are snapshots from one training run.
const HK_LEVELS: typeof LEVELS = [
  { id: 'easy', label: 'Easy', blurb: 'Early-training network, still beatable' },
  { id: 'normal', label: 'Normal', blurb: 'Mid-training network, builds good hands' },
  { id: 'hard', label: 'Hard', blurb: 'Fully trained network, big hands and few deal-ins' },
];

const SHOWCASE = [33, 32, 31, 27, 0, 13, 26, 34];

export function Home({ go }: { go: (p: Page) => void }) {
  const setup = useGame((s) => s.soloSetup);
  const [variant, setVariant] = useState<VariantId>(setup.variant);
  const info = VARIANTS.find((v) => v.id === variant)!;
  return (
    <div className="home">
      <header className="hero">
        <div className="hero-tiles" aria-hidden>
          {SHOWCASE.map((k, i) => (
            <Tile key={i} kind={k} style={{ ['--i' as string]: i }} />
          ))}
        </div>
        <h1>
          <span className="cjk">麻雀</span> Mahjong
        </h1>
        <p>Four ways to play — against the computer, with friends online, or drilling your discards.</p>
      </header>

      <section className="variants" aria-label="Variants">
        {VARIANTS.map((v) => (
          <button key={v.id} type="button" className={`variant ${v.id === variant ? 'on' : ''}`} onClick={() => setVariant(v.id)} aria-pressed={v.id === variant}>
            <span className="cjk zh">{v.zh}</span>
            <span className="name">{v.name}</span>
            <span className="status">{v.region}</span>
          </button>
        ))}
      </section>

      <div className="play-panels">
        <SoloPanel key={`solo-${variant}`} variant={variant} />
        <OnlinePanel variant={variant} />
        <section className="panel about">
          <h2>
            <span className="cjk">{info.zh}</span> {info.name}
          </h2>
          <p>{info.blurb}</p>
          <ul>
            {info.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <div className="links">
            <button type="button" className="btn ghost" onClick={() => go('rules')}>
              Rules &amp; scoring
            </button>
            <button type="button" className="btn ghost" onClick={() => go('train')}>
              Discard trainer
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SoloPanel({ variant }: { variant: VariantId }) {
  const setup = useGame((s) => s.soloSetup);
  const startSolo = useGame((s) => s.startSolo);
  const [name, setName] = useState(setup.name === 'You' ? savedName() || 'You' : setup.name);
  const [levels, setLevels] = useState(setup.levels);
  const [rules, setRules] = useState(setup.rules[variant]);
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel solo">
      <h2>Play the computer</h2>
      <label className="field">
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        Opponents
        <div className="opponents">
          {(['下家 Right', '對家 Across', '上家 Left'] as const).map((label, i) => (
            <label key={label} className="opp">
              <span>{label}</span>
              <select
                value={levels[i]}
                onChange={(e) => {
                  const next = [...levels] as typeof levels;
                  next[i] = e.target.value as AiLevel;
                  setLevels(next);
                }}
              >
                {(variant === 'hk' ? HK_LEVELS : LEVELS).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label} — {l.blurb}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <RulesSummary variant={variant} rules={rules} onEdit={() => setEditing(!editing)} editing={editing} />
      {editing && <RulesEditor variant={variant} rules={rules} onChange={setRules} />}
      <button
        type="button"
        className="btn primary big"
        onClick={() => startSolo({ variant, name: name.trim() || 'You', levels, rules: { ...setup.rules, [variant]: rules } })}
      >
        Deal the tiles
      </button>
    </section>
  );
}

function OnlinePanel({ variant }: { variant: VariantId }) {
  const net = useNet();
  const setup = useGame((s) => s.soloSetup);
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(roomCodeFromUrl() ?? '');
  const busy = net.status === 'connecting';
  const ok = name.trim().length > 0;
  return (
    <section className="panel online" onFocus={net.warmUp} onPointerEnter={net.warmUp}>
      <h2>Play with friends</h2>
      <p className="muted">Open a room and share its code. Empty seats can be filled with computer players.</p>
      <label className="field">
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Name shown at the table" />
      </label>
      <button type="button" className="btn primary" disabled={!ok || busy} onClick={() => void net.createRoom(name.trim(), variant, setup.rules[variant])}>
        Create a {VARIANTS.find((v) => v.id === variant)!.name} room
      </button>
      <form
        className="join"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && code) void net.joinRoom(code, name.trim());
        }}
      >
        <input value={code} onChange={(e) => setCode(normalizeRoomCode(e.target.value).slice(0, 6))} placeholder="Room code" aria-label="Room code" />
        <button type="submit" className="btn" disabled={!ok || code.length < 4 || busy}>
          Join
        </button>
      </form>
      {busy && <p className="muted">Connecting…</p>}
      {net.status === 'error' && <p className="error">{net.error}</p>}
    </section>
  );
}
