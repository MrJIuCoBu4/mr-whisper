import React from "react";
import App from "./App.jsx";
import SettingsWindow from "./components/SettingsWindow.tsx";
import TranscriptionPreview from "./components/TranscriptionPreview.tsx";

export default function AppRouter() {
  const params = window.location.search;
  if (params.includes("settings=true")) {
    return <SettingsWindow />;
  }
  if (params.includes("transcription-preview=true")) {
    return <TranscriptionPreview />;
  }
  return <App />;
}
