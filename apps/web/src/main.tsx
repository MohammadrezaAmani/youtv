import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./locales";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { initPwa } from "./lib/pwa";
import "./styles.css";
import "./refined.css";
import "./player.css";
import "./design-system.css";
import "./monitor.css";
import "./shell.css";
import "./mobile-fixes.css";
import "./pwa.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

initPwa();
