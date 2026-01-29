import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

/**
 * The entry point for OrderFlow Pro.
 * This script bootstraps the React application into the 'root' div defined in index.html.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error("Failed to find the root element. Check index.html for <div id='root'></div>");
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);