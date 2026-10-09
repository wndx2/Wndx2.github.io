import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MathfieldElement } from 'mathlive';
import 'mathlive/static.css';
import './styles.css';
import { App } from './App';

// Fonts come from the stylesheet above (bundled by Vite), which also styles the
// typeset labels on the graph. Key sounds are off.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
