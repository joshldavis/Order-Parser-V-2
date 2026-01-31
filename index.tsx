import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

console.log('OrderFlow: Module index.tsx starting...');

const container = document.getElementById('root');

if (!container) {
  console.error('OrderFlow: Root container element not found.');
} else {
  try {
    // Clear the bootstrapping text
    container.innerHTML = '';
    
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('OrderFlow: React render successful.');
  } catch (error) {
    console.error('OrderFlow: React render failed.', error);
    container.innerHTML = `<div style="padding: 2rem; color: #991b1b; background: #fff1f2; border: 1px solid #fecaca; border-radius: 1rem; margin: 2rem; font-family: sans-serif;">
      <h2 style="margin-top: 0; font-weight: 800;">DOM Mount Error</h2>
      <p>The application could not be mounted to the DOM root.</p>
      <pre style="background: #1a1a1a; color: #f87171; padding: 1.5rem; overflow: auto; border-radius: 0.5rem; font-size: 12px;">${error instanceof Error ? error.stack : String(error)}</pre>
    </div>`;
  }
}