// The start screens: first pick a game (a variant), then set it up — the
// computer opponents and house rules, or a room for friends. Joining a
// friend's room needs no variant (the room has one), so it sits on the picker.

import { useState } from 'react';
import { AI_LEVELS, type AiLevel } from '@/core/engine';
import type { Kind } from '@/core/tiles';
import { VARIANTS, type AnyRules, type VariantId } from '@/core/variants';
import { normalizeRoomCode, roomCodeFromUrl, savedName } from '@/net/room';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { RulesEditor, RulesSummary } from './RulesForms';
import { Tile } from './Tile';

export type Page = 'home' | 'train' | 'rules';

const SHOWCASE = [33, 32, 31, 27, 0, 13, 26, 34];

/** A few tiles that say what each variant is about (the game card's art). */
const CARD_TILES: Record<VariantId, { kind: Kind; red?: boolean }[]> = {
  hk: [{ kind: 33 }, { kind: 32 }, { kind: 31 }],
  taiwan: [{ kind: 34 }, { kind: 35 }, { kind: 38 }, { kind: 39 }],
  riichi: [{ kind: 4, red: true }, { kind: 13, red: true }, { kind: 22, red: true }],
  american: [{ kind: 42 }, { kind: 27 }, { kind: 42 }],
};

/** `variant` is the game picked (null: the picker); it lives in App so the rules page can come back to it. */
export function Home({ variant, pick, go }: { variant: VariantId | null; pick: (v: VariantId | null) => void; go: (p: Page) => void }) {
  if (variant) return <Setup key={variant} variant={variant} back={() => pick(null)} go={go} />;
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
        <p>Pick a game — then play the computer, open a room for friends, or drill your discards.</p>
      </header>

      <section className="variants" aria-label="Games">
        {VARIANTS.map((v) => (
          <button key={v.id} type="button" className="variant" onClick={() => pick(v.id)}>
            <span className="art" aria-hidden>
              {CARD_TILES[v.id].map((t, i) => (
                <Tile key={i} kind={t.kind} red={t.red} />
              ))}
            </span>
            <span className="cjk zh">{v.zh}</span>
            <span className="name">{v.name}</span>
            <span className="status">{v.region}</span>
            <span className="blurb">{v.blurb}</span>
          </button>
        ))}
      </section>

      <JoinPanel />
    </div>
  );
}

function Setup({ variant, back, go }: { variant: VariantId; back: () => void; go: (p: Page) => void }) {
  const setup = useGame((s) => s.soloSetup);
  const [rules, setRules] = useState(setup.rules[variant]);
  const info = VARIANTS.find((v) => v.id === variant)!;
  return (
    <div className="home setup">
      <div className="setup-bar">
        <button type="button" className="btn ghost" onClick={back}>
          ← Back
        </button>
        <button type="button" className="btn ghost" onClick={() => go('rules')}>
          Rules &amp; scoring
        </button>
      </div>
      <header className="setup-head">
        <h1>
          <span className="cjk">{info.zh}</span> {info.name}
        </h1>
        <p>{info.blurb}</p>
        <ul>
          {info.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </header>
      <div className="play-panels">
        <SoloPanel variant={variant} rules={rules} setRules={setRules} />
        <HostPanel variant={variant} rules={rules} />
      </div>
    </div>
  );
}

function SoloPanel({ variant, rules, setRules }: { variant: VariantId; rules: AnyRules; setRules: (r: AnyRules) => void }) {
  const setup = useGame((s) => s.soloSetup);
  const startSolo = useGame((s) => s.startSolo);
  const [name, setName] = useState(setup.name === 'You' ? savedName() || 'You' : setup.name);
  const [levels, setLevels] = useState(setup.levels);
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
                {AI_LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
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

function HostPanel({ variant, rules }: { variant: VariantId; rules: AnyRules }) {
  const net = useNet();
  const [name, setName] = useState(savedName());
  const busy = net.status === 'connecting';
  return (
    <section className="panel online" onFocus={net.warmUp} onPointerEnter={net.warmUp}>
      <h2>Play with friends</h2>
      <p className="muted">Open a room with these house rules and share its code. Empty seats can be filled with computer players.</p>
      <label className="field">
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Name shown at the table" />
      </label>
      <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={() => void net.createRoom(name.trim(), variant, rules)}>
        Create a room
      </button>
      <NetStatus />
    </section>
  );
}

function JoinPanel() {
  const net = useNet();
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(roomCodeFromUrl() ?? '');
  const busy = net.status === 'connecting';
  const ok = name.trim().length > 0 && code.length >= 4 && !busy;
  return (
    <section className="panel join-panel" onFocus={net.warmUp} onPointerEnter={net.warmUp}>
      <h2>Join a friend's room</h2>
      <form
        className="join"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) void net.joinRoom(code, name.trim());
        }}
      >
        <input className="name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
        <input className="code" value={code} onChange={(e) => setCode(normalizeRoomCode(e.target.value).slice(0, 6))} placeholder="Room code" aria-label="Room code" />
        <button type="submit" className="btn primary" disabled={!ok}>
          Join
        </button>
      </form>
      <NetStatus />
    </section>
  );
}

function NetStatus() {
  const net = useNet();
  if (net.status === 'connecting') return <p className="muted">Connecting…</p>;
  if (net.status === 'error') return <p className="error">{net.error}</p>;
  return null;
}
