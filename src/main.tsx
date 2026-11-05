import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { runDemo } from './ui/devDemo';
import './ui/styles.css';

// Dev only (tree-shaken from builds): ?demo=… fast-forwards a solo match.
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  if (params.has('demo')) runDemo(params);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
