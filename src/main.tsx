import { appStorage } from './storage';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme.css';
import './styles.css';
import 'katex/dist/katex.min.css';
import './components/ui.css';
// Retire the exploratory palette preference and its temporary deep link.
try { appStorage.removeItem('ari:palette'); } catch { /* Storage can be unavailable. */ }
if (window.location.hash === '#appearance')
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
