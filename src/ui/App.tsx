import { useEffect, useState } from 'react';
import type { VariantId } from '@/core/variants';
import { roomCodeFromUrl, savedName } from '@/net/room';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { Home, type Page } from './Home';
import { Lobby } from './Lobby';
import { RulesPage } from './RulesPage';
import { Table } from './Table';
import { Training } from './Training';

/** `?page=train` / `?page=rules` deep links. */
function pageFromUrl(): Page {
  try {
    const p = new URLSearchParams(window.location.search).get('page');
    return p === 'train' || p === 'rules' ? p : 'home';
  } catch {
    return 'home';
  }
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromUrl);
  // The game picked on the home screen (null: the picker). Kept here so the rules page and a finished match come back to it.
  const [variant, setVariant] = useState<VariantId | null>(null);
  const match = useGame((s) => s.match);
  const mode = useGame((s) => s.mode);
  const leaveSolo = useGame((s) => s.leave);
  const net = useNet();

  // A reload (or an invite link) with ?room=CODE rejoins when a name is saved.
  useEffect(() => {
    const code = roomCodeFromUrl();
    const name = savedName();
    if (code && name && useNet.getState().status === 'idle') void useNet.getState().joinRoom(code, name);
  }, []);

  const inRoom = net.status === 'room';
  const view = match ? 'table' : inRoom ? 'lobby' : page;

  const nav = (p: Page) => {
    if (mode === 'solo' && match && !confirm('Leave the current match?')) return;
    if (mode === 'solo') leaveSolo();
    if (inRoom) net.leaveRoom();
    if (p === 'home') setVariant(null);
    setPage(p);
  };

  return (
    <div className={`app view-${view}`}>
      <nav className="topbar">
        <button type="button" className="brand" onClick={() => nav('home')}>
          <svg viewBox="0 0 64 64" aria-hidden>
            <rect x="13" y="7" width="42" height="54" rx="8" fill="#17603d" />
            <rect x="9" y="3" width="42" height="54" rx="8" fill="#fbf7ec" stroke="#c9bd9c" strokeWidth="1.5" />
            <rect x="17.5" y="20" width="25" height="17" rx="2.5" fill="none" stroke="#c8202f" strokeWidth="5" />
            <rect x="27.5" y="9.5" width="5" height="39" rx="2" fill="#c8202f" />
          </svg>
          <span className="cjk">麻雀</span>
          <span className="en">Mahjong</span>
        </button>
        <span className="spacer" />
        {inRoom && <span className="room-chip">Room {net.code}</span>}
        <button type="button" className={`nav ${view === 'home' ? 'on' : ''}`} onClick={() => nav('home')}>
          Play
        </button>
        <button type="button" className={`nav ${view === 'train' ? 'on' : ''}`} onClick={() => nav('train')}>
          Train
        </button>
        <button type="button" className={`nav ${view === 'rules' ? 'on' : ''}`} onClick={() => nav('rules')}>
          Rules
        </button>
      </nav>
      <main>
        {view === 'table' && <Table />}
        {view === 'lobby' && <Lobby />}
        {view === 'home' && <Home variant={variant} pick={setVariant} go={setPage} />}
        {view === 'train' && <Training />}
        {view === 'rules' && <RulesPage initial={variant ?? 'hk'} back={() => setPage('home')} />}
      </main>
    </div>
  );
}
