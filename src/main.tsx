import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui/Toast';
import { OnlineStatus } from './components/ui/OnlineStatus';

import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Service workers cache modules aggressively. Keep them out of Vite
// development so hot reloads never serve stale application code; production
// builds still register the worker for offline app-shell access.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (reg) => console.log('[SW] Registered:', reg.scope),
        (err) => console.warn('[SW] Registration failed:', err)
      );
    });
  } else {
    void navigator.serviceWorker.getRegistrations().then(
      (registrations) => Promise.all(registrations.map((registration) => registration.unregister()))
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
            <OnlineStatus />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
