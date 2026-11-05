// The start screen: pick a variant, then play the computer or open / join an
// online room. Also home to the house-rules editor the lobby reuses.

import { useState } from 'react';
import type { AiLevel } from '@/core/engine';
import { VARIANTS, type VariantInfo } from '@/core/variants';
import { DEFAULT_HK_RULES, type HkRules } from '@/core/variants/hk';
import { savedName, roomCodeFromUrl, normalizeRoomCode } from '@/net/room';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { Tile } from './Tile';

export type Page = 'home' | 'train' | 'rules';

const LEVELS: { id: AiLevel; label: string; blurb: string }[] = [
  { id: 'easy', label: 'Easy', blurb: 'Plays for speed, makes mistakes' },
  { id: 'normal', label: 'Normal', blurb: 'Builds hands that score' },
  { id: 'hard', label: 'Hard', blurb: 'Also defends against open hands' },
];

const SHOWCASE = [33, 32, 31, 27, 0, 13, 26, 34];

export function Home({ go }: { go: (p: Page) => void }) {
  const [variant, setVariant] = useState<VariantInfo['id']>('hk');
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
        <p>Play the computer, play friends online, or sharpen your discards.</p>
      </header>

      <section className="variants" aria-label="Variants">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`variant ${v.id === variant ? 'on' : ''} ${v.status}`}
            onClick={() => setVariant(v.id)}
            aria-pressed={v.id === variant}
          >
            <span className="cjk zh">{v.zh}</span>
            <span className="name">{v.name}</span>
            <span className="status">{v.status === 'playable' ? 'Play now' : 'Coming soon'}</span>
          </button>
        ))}
      </section>

      {info.status === 'playable' ? (
        <div className="play-panels">
          <SoloPanel />
          <OnlinePanel />
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
                Rules &amp; faan table
              </button>
              <button type="button" className="btn ghost" onClick={() => go('train')}>
                Discard trainer
              </button>
            </div>
          </section>
        </div>
      ) : (
        <PlannedVariant info={info} />
      )}
    </div>
  );
}

function PlannedVariant({ info }: { info: VariantInfo }) {
  return (
    <section className="panel planned">
      <h2>
        <span className="cjk">{info.zh}</span> {info.name} <span className="tag">coming soon</span>
      </h2>
      <p>{info.blurb}</p>
      <div className="cols">
        <div>
          <h4>How it plays</h4>
          <ul>
            {info.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Already in the framework</h4>
          <ul>
            <li>
              {info.tiles.bonus + 136 + info.tiles.jokers}-tile wall{info.tiles.jokers ? ' with jokers' : ''}
              {info.tiles.bonus ? ', bonus tiles' : ', no bonus tiles'}
            </li>
            <li>{info.handSize}-tile hands</li>
            <li>{info.reserve ? `${info.reserve} tiles held back at the end of the wall` : 'Play to the last tile'}</li>
            <li>Shared draw / discard / claim loop, kongs, online rooms, AI</li>
          </ul>
          <h4>Still to build</h4>
          <ul>
            {info.needs?.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SoloPanel() {
  const setup = useGame((s) => s.soloSetup);
  const startSolo = useGame((s) => s.startSolo);
  const [name, setName] = useState(setup.name === 'You' ? savedName() || 'You' : setup.name);
  const [levels, setLevels] = useState(setup.levels);
  const [rules, setRules] = useState(setup.rules);
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
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label} — {l.blurb}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <RulesSummary rules={rules} onEdit={() => setEditing(!editing)} editing={editing} />
      {editing && <RulesEditor rules={rules} onChange={setRules} />}
      <button type="button" className="btn primary big" onClick={() => startSolo({ name: name.trim() || 'You', levels, rules })}>
        Deal the tiles
      </button>
    </section>
  );
}

function OnlinePanel() {
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
      <button type="button" className="btn primary" disabled={!ok || busy} onClick={() => void net.createRoom(name.trim(), setup.rules)}>
        Create a room
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

// ------------------------------------------------------------ house rules

export function RulesSummary({ rules, onEdit, editing }: { rules: HkRules; onEdit?: () => void; editing?: boolean }) {
  const bits = [
    `${rules.minFaan}-faan minimum`,
    `${rules.maxFaan}-faan limit`,
    rules.spicy === 'half' ? 'half-spicy' : 'full-spicy',
    rules.payment === 'halfGun' ? '半銃 discarder pays half' : '全銃 discarder pays all',
    rules.rounds === 1 ? 'East round only' : rules.rounds === 2 ? 'East & South rounds' : 'full four rounds',
  ];
  if (rules.sevenPairs) bits.push('seven pairs');
  if (rules.multiWin) bits.push('multiple winners');
  return (
    <div className="rules-summary">
      <span>
        <b>House rules:</b> {bits.join(' · ')}
      </span>
      {onEdit && (
        <button type="button" className="btn small ghost" onClick={onEdit}>
          {editing ? 'Done' : 'Change'}
        </button>
      )}
    </div>
  );
}

export function RulesEditor({ rules, onChange, readOnly }: { rules: HkRules; onChange: (r: HkRules) => void; readOnly?: boolean }) {
  const set = <K extends keyof HkRules>(key: K, value: HkRules[K]) => onChange({ ...rules, [key]: value });
  const check = (key: 'liability' | 'sevenPairs' | 'flowerHands' | 'multiWin' | 'dealerStaysOnDraw' | 'robConcealedKong', label: string, disabled = false) => (
    <label className="row check">
      <input type="checkbox" checked={rules[key]} disabled={readOnly || disabled} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <fieldset className="rules-editor" disabled={readOnly}>
      <label className="row">
        Minimum to win
        <select value={rules.minFaan} onChange={(e) => set('minFaan', Number(e.target.value))}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? '0 (雞糊 allowed)' : `${n} faan`}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        Limit (爆棚)
        <select value={rules.maxFaan} onChange={(e) => set('maxFaan', Number(e.target.value))}>
          {[8, 10, 13].map((n) => (
            <option key={n} value={n}>
              {n} faan
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        Points
        <select value={rules.spicy} onChange={(e) => set('spicy', e.target.value as HkRules['spicy'])}>
          <option value="half">半辣 half-spicy</option>
          <option value="full">全辣 full-spicy</option>
        </select>
      </label>
      <label className="row">
        Discard win
        <select value={rules.payment} onChange={(e) => set('payment', e.target.value as HkRules['payment'])}>
          <option value="halfGun">半銃 discarder pays half</option>
          <option value="fullGun">全銃 discarder pays all</option>
        </select>
      </label>
      <label className="row">
        Match length
        <select value={rules.rounds} onChange={(e) => set('rounds', Number(e.target.value) as HkRules['rounds'])}>
          <option value={1}>東風 East round</option>
          <option value={2}>東南 two rounds</option>
          <option value={4}>全莊 all four winds</option>
        </select>
      </label>
      <label className="row">
        Starting points
        <input type="number" min={0} step={50} value={rules.startingScore} onChange={(e) => set('startingScore', Math.max(0, Number(e.target.value) || 0))} />
      </label>
      {check('liability', '包 liability: whoever feeds a big hand pays for everyone', rules.payment !== 'halfGun')}
      {check('flowerHands', '八仙過海 / 七搶一 flower wins')}
      {check('dealerStaysOnDraw', 'Dealer keeps the deal after a draw')}
      {check('robConcealedKong', '十三么 may rob a concealed kong')}
      {check('sevenPairs', '七對子 seven pairs (4 faan)')}
      {check('multiWin', '一炮多響 several players may win on one discard')}
      {!readOnly && (
        <button type="button" className="btn small ghost" onClick={() => onChange(DEFAULT_HK_RULES)}>
          Reset to HK Old Style defaults
        </button>
      )}
    </fieldset>
  );
}
