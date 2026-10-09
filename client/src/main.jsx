import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthProvider.jsx";
import { installStaleAssetRecovery } from "./utils/staleAssetRecovery.js";

installStaleAssetRecovery(window, import.meta.url);

createRoot(document.getElementById("root")).render(
  <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
  </StrictMode>
);
