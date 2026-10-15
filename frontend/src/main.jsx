import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './lib/AppContext';
import './index.css';

// Deep links: Vercel rewrites them to index.html (frontend/vercel.json). GitHub Pages has
// no rewrites, so public/404.html stores the requested path (e.g. /trafficsense/predict)
// in sessionStorage and redirects to the app shell; restore it before the router reads it.
const redirect = sessionStorage.getItem('ts-redirect');
if (redirect) {
  sessionStorage.removeItem('ts-redirect');
  window.history.replaceState(null, '', redirect);
}

// Vite's BASE_URL is "/trafficsense/" on GitHub Pages and "/" on Vercel and locally.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
