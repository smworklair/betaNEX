import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppProvider } from './ui';

const el = document.getElementById('root');
if (!el) throw new Error('Не найден корневой элемент #root');

createRoot(el).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
