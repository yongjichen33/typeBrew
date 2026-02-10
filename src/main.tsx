import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import App from "./App";
import { FontViewer } from "./pages/FontViewer";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/font/:fontName" element={<FontViewer />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
