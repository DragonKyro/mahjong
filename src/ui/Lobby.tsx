// The online room before (and between) matches: seats, house rules, chat.

import { useState } from 'react';
import type { AiLevel } from '@/core/engine';
import { VARIANTS, normalizeRulesFor, type VariantId } from '@/core/variants';
import { roomLink, type LobbySeat } from '@/net/room';
import { AI_NAMES } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { RulesEditor, RulesSummary } from './RulesForms';
import { Chat } from './TablePanels';

export function Lobby() {
  const net = useNet();
  const [copied, setCopied] = useState(false);
  const lobby = net.lobby;
  if (!lobby) return <div className="center-msg">Opening the room…</div>;
  const isHost = lobby.hostUuid === net.uuid;
  const variant = lobby.variant;
  const rules = normalizeRulesFor(variant, JSON.parse(lobby.rulesJson));
  const online = new Set(net.people.map((p) => p.uuid));
  const mine = lobby.seats.findIndex((s) => s.kind === 'human' && s.uuid === net.uuid);
  const open = lobby.seats.filter((s) => s.kind === 'open').length;

  const setSeat = (i: number, value: string) => {
    let seat: LobbySeat;
    if (value === 'open') seat = { kind: 'open' };
    else {
      const used = new Set(lobby.seats.flatMap((s) => (s.kind === 'ai' ? [s.name] : [])));
      const current = lobby.seats[i];
      const name = current?.kind === 'ai' ? current.name : (AI_NAMES.find((n) => !used.has(n)) ?? 'Bot');
      seat = { kind: 'ai', level: value as AiLevel, name };
    }
    void net.setSeat(i, seat);
  };

  return (
    <div className="lobby">
      <section className="panel room-head">
        <div>
          <div className="muted">Room code</div>
          <div className="code">{net.code}</div>
        </div>
        <div className="share">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(roomLink(net.code!)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          <button type="button" className="btn ghost" onClick={net.leaveRoom}>
            Leave
          </button>
        </div>
      </section>

      <div className="lobby-grid">
        <section className="panel seats">
          <h2>Seats</h2>
          <p className="muted small">Seat winds are drawn when the match starts.</p>
          {lobby.seats.map((s, i) => (
            <div key={i} className={`seat-row ${i === mine ? 'me' : ''}`}>
              <span className="num">{i + 1}</span>
              <span className="who">
                {s.kind === 'human' && (
                  <>
                    <b>{s.name}</b>
                    {s.uuid === lobby.hostUuid && <span className="tag">host</span>}
                    {!online.has(s.uuid) && <span className="tag warn">offline</span>}
                  </>
                )}
                {s.kind === 'ai' && (
                  <>
                    <b>{s.name}</b> <span className="tag">computer · {s.level}</span>
                  </>
                )}
                {s.kind === 'open' && <span className="muted">Open seat</span>}
              </span>
              <span className="controls">
                {isHost && s.kind !== 'human' && (
                  <select value={s.kind === 'ai' ? s.level : 'open'} onChange={(e) => setSeat(i, e.target.value)} aria-label={`Seat ${i + 1}`}>
                    <option value="open">Open for a friend</option>
                    <option value="easy">Computer — easy</option>
                    <option value="normal">Computer — normal</option>
                    <option value="hard">Computer — hard</option>
                  </select>
                )}
                {isHost && s.kind === 'human' && s.uuid !== net.uuid && (
                  <button type="button" className="btn small ghost" onClick={() => void net.setSeat(i, { kind: 'open' })}>
                    Remove
                  </button>
                )}
                {!isHost && s.kind === 'open' && (
                  <button type="button" className="btn small" onClick={() => void net.takeSeat(i)}>
                    Sit here
                  </button>
                )}
              </span>
            </div>
          ))}
          {isHost ? (
            <div className="start">
              {open > 0 && (
                <button type="button" className="btn ghost" onClick={() => void net.fillWithAi()}>
                  Fill {open} empty seat{open > 1 ? 's' : ''} with computer players
                </button>
              )}
              <button type="button" className="btn primary big" disabled={open > 0} onClick={() => void net.startMatch()}>
                {open > 0 ? 'Waiting for players…' : 'Start the match'}
              </button>
            </div>
          ) : (
            <p className="muted">{mine >= 0 ? 'The host will start the match.' : 'All seats are taken — you can watch once the match starts.'}</p>
          )}
        </section>

        <section className="panel">
          <h2>Game</h2>
          <label className="row">
            Variant
            <select value={variant} disabled={!isHost} onChange={(e) => void net.setVariant(e.target.value as VariantId)}>
              {VARIANTS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.zh} {v.name}
                </option>
              ))}
            </select>
          </label>
          <RulesSummary variant={variant} rules={rules} />
          <RulesEditor variant={variant} rules={rules} onChange={(r) => void net.setRules(r)} readOnly={!isHost} />
        </section>

        <div className="panel chat-panel">
          <Chat />
        </div>
      </div>
    </div>
  );
}
