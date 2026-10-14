import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './lib/AppContext';
import './index.css';

// GitHub Pages has no server-side routing. public/404.html stores the requested deep
// link (e.g. /trafficsense/predict) in sessionStorage and redirects to index.html;
// restore it here before the router reads the URL.
const redirect = sessionStorage.getItem('ts-redirect');
if (redirect) {
  sessionStorage.removeItem('ts-redirect');
  window.history.replaceState(null, '', redirect);
}

// Vite's BASE_URL is "/trafficsense/" on GitHub Pages and "/" locally.
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
