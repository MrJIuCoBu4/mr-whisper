const { contextBridge, ipcRenderer } = require("electron");

const registerListener = (channel, handlerFactory) => {
  return (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener =
      typeof handlerFactory === "function"
        ? handlerFactory(callback)
        : (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld("electronAPI", {
  pasteText: (text, options) => ipcRenderer.invoke("paste-text", text, options),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  openSettingsWindow: () => ipcRenderer.invoke("open-settings-window"),
  closeSettingsWindow: () => ipcRenderer.invoke("close-settings-window"),

  onToggleDictation: registerListener("toggle-dictation", (callback) => () => callback()),
  onStartDictation: registerListener("start-dictation", (callback) => () => callback()),
  onStopDictation: registerListener("stop-dictation", (callback) => () => callback()),

  transcribeLocalWhisper: (audioBlob, options) =>
    ipcRenderer.invoke("transcribe-local-whisper", audioBlob, options),
  formatText: (text) => ipcRenderer.invoke("format-text", text),
  getSttConfig: () => ipcRenderer.invoke("get-stt-config"),
  getFormattingConfig: () => ipcRenderer.invoke("get-formatting-config"),

  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (updates) => ipcRenderer.invoke("save-config", updates),

  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  saveDictationKey: (key) => ipcRenderer.invoke("save-dictation-key", key),
  getActiveDictationKey: () => ipcRenderer.invoke("get-active-dictation-key"),
  getEffectiveDefaultHotkey: () => ipcRenderer.invoke("get-effective-default-hotkey"),
  setHotkeyListeningMode: (enabled, newHotkey) =>
    ipcRenderer.invoke("set-hotkey-listening-mode", enabled, newHotkey),

  getActivationMode: () => ipcRenderer.invoke("get-activation-mode"),
  saveActivationMode: (mode) => ipcRenderer.invoke("save-activation-mode", mode),

  checkWhisperInstallation: () => ipcRenderer.invoke("check-whisper-installation"),

  showDictationPreview: (text) => ipcRenderer.invoke("show-dictation-preview", text),
  hideDictationPreview: () => ipcRenderer.invoke("hide-dictation-preview"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),
  getPreviewState: () => ipcRenderer.invoke("get-preview-state"),
  resizeTranscriptionPreviewWindow: (width, height) =>
    ipcRenderer.invoke("resize-transcription-preview-window", width, height),

  onPreviewText: registerListener("preview-text", (callback) => (_event, text) => callback(text)),
  onPreviewHide: registerListener("preview-hide", (callback) => () => callback()),
});
