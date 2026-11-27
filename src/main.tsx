import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { FeedbackProvider } from './components/ui/feedback';
import { SettingsProvider } from './hooks/useSettings';
import { NumberingProvider } from './features/numbering/NumberingContext';
import './index.css';
import { DOC_FONT_CSS } from '@shared/docFonts';

// Font dokumen pengganti juga untuk editor (kertas A4).
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: DOC_FONT_CSS }));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <FeedbackProvider>
        <SettingsProvider>
          <NumberingProvider>
            <App />
          </NumberingProvider>
        </SettingsProvider>
      </FeedbackProvider>
    </HashRouter>
  </React.StrictMode>
);
