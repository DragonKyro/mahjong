import { useState } from 'react';
import { Board } from './components/Board';
import { TrainingPage } from './components/TrainingPage';
import { MultiplayerPage } from './components/MultiplayerPage';

type Mode = 'game' | 'training' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<Mode>('game');
  return (
    <div className="min-h-screen bg-felt-dark text-white font-cjk">
      <nav className="flex gap-2 p-2 bg-stone-900/60 border-b border-stone-700 text-sm">
        <TabButton active={mode === 'game'} onClick={() => setMode('game')}>
          廣東麻雀 · Play
        </TabButton>
        <TabButton active={mode === 'training'} onClick={() => setMode('training')}>
          訓練 · Training
        </TabButton>
        <TabButton active={mode === 'multiplayer'} onClick={() => setMode('multiplayer')}>
          連線 · Multiplayer
        </TabButton>
      </nav>
      {mode === 'game' && <Board />}
      {mode === 'training' && <TrainingPage />}
      {mode === 'multiplayer' && <MultiplayerPage />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = 'px-3 py-1 rounded';
  const cls = active ? `${base} bg-amber-700` : `${base} bg-stone-700 hover:bg-stone-600`;
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
