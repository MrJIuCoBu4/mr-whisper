/// <reference types="vite/client" />

import "react";

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.gif" {
  const src: string;
  export default src;
}

export {};

declare global {
  // Shape of %APPDATA%\open-whispr\config.json as far as the renderer cares.
  interface AppConfig {
    whisperModelPath?: string;
    whisperServerUrl?: string;
    whisperVad?: boolean;
    whisperBeamSize?: number;
    suppressNonSpeech?: boolean;
    whisperPrompt?: string;
    formattingModelPath?: string;
    formattingEnabled?: boolean;
    resultWindow?: boolean;
    language?: string;
    hotkey?: string;
    activationMode?: "push-to-talk" | "tap-to-talk";
    microphoneDeviceId?: string;
    preferBuiltInMic?: boolean;
  }

  interface ElectronAPI {
  pasteText: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  hideWindow: () => Promise<void>;
  showDictationPanel: () => Promise<void>;
  openSettingsWindow: () => Promise<void>;
  closeSettingsWindow: () => Promise<void>;
  onToggleDictation: (callback: () => void) => () => void;
  onStartDictation: (callback: () => void) => () => void;
  onStopDictation: (callback: () => void) => () => void;
  transcribeLocalWhisper: (audioBlob: Blob, options?: Record<string, unknown>) => Promise<unknown>;
  formatText: (text: string) => Promise<unknown>;
  getSttConfig: () => Promise<unknown>;
  getFormattingConfig: () => Promise<unknown>;
  getConfig: () => Promise<{ success?: boolean; config?: AppConfig; error?: string }>;
  saveConfig: (updates: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
  updateHotkey: (hotkey: string) => Promise<unknown>;
  saveDictationKey: (key: string) => Promise<unknown>;
  getActiveDictationKey: () => Promise<unknown>;
  getEffectiveDefaultHotkey: () => Promise<unknown>;
  setHotkeyListeningMode: (enabled: boolean, newHotkey?: string) => Promise<unknown>;
  getActivationMode: () => Promise<unknown>;
  saveActivationMode: (mode: string) => Promise<unknown>;
  checkWhisperInstallation: () => Promise<unknown>;
  getPlatform?: () => string;
  onGlobeKeyPressed?: (callback: () => void) => () => void;
  onGlobeKeyReleased?: (callback: () => void) => () => void;
  showDictationPreview?: (
    text: string
  ) => Promise<{ shown?: boolean; autoHideMs?: number } | unknown>;
  hideDictationPreview?: () => Promise<unknown>;
  writeClipboard?: (text: string) => Promise<unknown>;
  getPreviewState?: () => Promise<{ success?: boolean; text?: string; autoHideMs?: number } | unknown>;
  resizeTranscriptionPreviewWindow?: (width: number, height: number) => Promise<unknown>;
  onPreviewText?: (callback: (text: string) => void) => () => void;
  onPreviewHide?: (callback: () => void) => () => void;
}

  interface Window {
    electronAPI: ElectronAPI;
  }
}
