import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './telegram.js';
import { initTheme } from './theme.js';

initTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
