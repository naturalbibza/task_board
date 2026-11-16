import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './state/auth-context';
import { ThemeProvider } from './theme/theme-provider';
import { Toaster } from './components/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={250}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
