const { clipboard, ipcMain } = require("electron");
const debugLogger = require("./debugLogger");
const { isWindowsTextInputFocused } = require("./windowsFocusDetector");

class IPCHandlersMinimal {
  constructor({
    windowManager,
    whisperManager,
    formattingManager,
    clipboardManager,
    configManager,
    windowsKeyManager,
  }) {
    this.windowManager = windowManager;
    this.whisperManager = whisperManager;
    this.formattingManager = formattingManager;
    this.clipboardManager = clipboardManager;
    this.configManager = configManager;
    this.windowsKeyManager = windowsKeyManager;
    this._hotkeyCaptureMode = false;
    this.registerHandlers();
  }

  registerHandlers() {
    ipcMain.handle("get-config", async () => {
      return { success: true, config: this.configManager.get() };
    });

    ipcMain.handle("save-config", async (_event, updates = {}) => {
      try {
        const config = this.configManager.save(updates);
        if (updates.hotkey) {
          await this.windowManager.updateHotkey(updates.hotkey);
          ipcMain.emit("hotkey-changed", null, updates.hotkey);
        }
        if (updates.activationMode) {
          const mode = config.activationMode === "tap-to-talk" ? "tap" : "push";
          this.windowManager.setActivationModeCache(mode);
          ipcMain.emit("activation-mode-changed", null, mode);
        }
        if (updates.whisperModelPath) {
          await this.whisperManager.initializeFromConfig(config);
        }
        if (updates.formattingModelPath || updates.formattingEnabled !== undefined) {
          await this.formattingManager.initializeFromConfig(config);
        }
        return { success: true, config };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("transcribe-local-whisper", async (_event, audioBlob, options = {}) => {
      try {
        const config = this.configManager.get();
        // With an external engine the local model file is not used at all.
        const usingExternalEngine = !!config.whisperServerUrl;
        const modelPath = usingExternalEngine ? null : this.configManager.getModelPath();
        if (!usingExternalEngine && !modelPath) {
          throw new Error(
            this.configManager.getModelValidation().error ||
              "Whisper model path not configured in config.json"
          );
        }

        const language =
          options.language ||
          (config.language && config.language !== "auto" ? config.language : null);

        const result = await this.whisperManager.transcribeLocalWhisper(audioBlob, {
          modelPath,
          language,
          initialPrompt: options.initialPrompt || config.whisperPrompt || null,
          // Quality knobs: trim silence, suppress non-speech tokens, beam search.
          vadEnabled: config.whisperVad !== false,
          beamSize: config.whisperBeamSize ?? 5,
          suppressNonSpeech: config.suppressNonSpeech !== false,
        });

        if (!result?.success || !result?.text?.trim()) {
          return {
            success: false,
            error: result?.message || "No speech detected",
          };
        }

        return {
          success: true,
          text: result.text,
          rawText: result.text,
          source: "whisper-local",
        };
      } catch (error) {
        debugLogger.error("transcribe-local-whisper failed", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("paste-text", async (_event, text, options = {}) => {
      const autoDetectFocus = options.autoDetectFocus !== false;

      if (autoDetectFocus && !isWindowsTextInputFocused()) {
        clipboard.writeText(text);
        debugLogger.info("paste-text: no text field focused, copied to clipboard", {
          length: text?.length || 0,
        });
        return { success: true, mode: "clipboard" };
      }

      try {
        await this.clipboardManager.pasteText(text, {
          ...options,
          restoreClipboard: false,
        });
        return { success: true, mode: "paste" };
      } catch (error) {
        clipboard.writeText(text);
        debugLogger.warn("paste-text failed, kept in clipboard", { error: error.message });
        return { success: true, mode: "clipboard" };
      }
    });

    ipcMain.handle("update-hotkey", async (_event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("save-dictation-key", async (_event, key) => {
      this.configManager.save({ hotkey: key });
      return { success: true };
    });

    ipcMain.handle("get-active-dictation-key", async () => {
      return this.windowManager?.hotkeyManager?.currentHotkey ?? null;
    });

    ipcMain.handle("get-effective-default-hotkey", async () => {
      return this.windowManager?.hotkeyManager?.getEffectiveDefaultHotkey() ?? "Alt+Z";
    });

    ipcMain.handle("get-activation-mode", async () => {
      return this.configManager.getActivationMode();
    });

    ipcMain.handle("save-activation-mode", async (_event, mode) => {
      const stored = mode === "tap" ? "tap-to-talk" : "push-to-talk";
      this.configManager.save({ activationMode: stored });
      this.windowManager.setActivationModeCache(mode);
      ipcMain.emit("activation-mode-changed", null, mode);
      return { success: true };
    });

    ipcMain.handle("set-hotkey-listening-mode", async (_event, enabled, newHotkey = null) => {
      if (this._hotkeyCaptureMode === enabled) return { success: true, skipped: true };
      this._hotkeyCaptureMode = enabled;
      this.windowManager.setHotkeyListeningMode(enabled);

      if (!enabled && newHotkey) {
        await this.windowManager.updateHotkey(newHotkey);
        this.configManager.save({ hotkey: newHotkey });
        ipcMain.emit("hotkey-changed", null, newHotkey);
      }

      return { success: true };
    });

    ipcMain.handle("check-whisper-installation", async () => {
      return this.whisperManager.checkWhisperInstallation();
    });

    ipcMain.handle("show-dictation-panel", async () => {
      this.windowManager.showDictationPanel({ focus: false });
      return { success: true };
    });

    ipcMain.handle("hide-window", async () => {
      this.windowManager.hideDictationPanel();
      return { success: true };
    });

    ipcMain.handle("open-settings-window", async () => {
      await this.windowManager.showSettingsWindow();
      return { success: true };
    });

    ipcMain.handle("close-settings-window", async () => {
      const win = this.windowManager?.settingsWindow;
      if (win && !win.isDestroyed()) {
        win.close();
      }
      return { success: true };
    });

    ipcMain.handle("get-stt-config", async () => {
      const config = this.configManager.get();
      const validation = this.configManager.getModelValidation();
      // The renderer refuses to record unless modelReady — an external engine is ready
      // on its own, so it must not be gated on the local .bin file.
      const usingExternalEngine = !!config.whisperServerUrl;
      return {
        success: true,
        useLocalWhisper: true,
        modelPath: usingExternalEngine
          ? config.whisperServerUrl
          : validation.valid
            ? validation.path
            : null,
        modelReady: usingExternalEngine || validation.valid,
        modelError: usingExternalEngine || validation.valid ? null : validation.error,
      };
    });

    ipcMain.handle("format-text", async (_event, text) => {
      try {
        const config = this.configManager.get();
        const result = await this.formattingManager.formatText(text, config);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return {
          success: true,
          text: result.text,
          rawText: result.rawText ?? text,
          skipped: !!result.skipped,
          fallback: !!result.fallback,
          rejected: !!result.rejected,
        };
      } catch (error) {
        debugLogger.error("format-text failed", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-formatting-config", async () => {
      const config = this.configManager.get();
      const validation = this.configManager.getFormattingModelValidation();
      return {
        success: true,
        enabled: config.formattingEnabled !== false,
        modelPath: validation.valid ? validation.path : null,
        modelReady: validation.valid,
        modelError: validation.valid ? null : validation.error,
        serverAvailable: this.formattingManager.isServerAvailable(),
      };
    });

    // Shows the last transcription in its own window instead of pasting it into the
    // focused app. The text also goes to the clipboard so it is never lost.
    ipcMain.handle("show-dictation-preview", async (_event, text) => {
      const previewText = typeof text === "string" ? text : "";

      if (this.configManager.get().resultWindow === false) {
        return { shown: false };
      }

      // The preview window is non-focusable and sandboxed, so navigator.clipboard
      // there would reject — copy from the main process instead.
      if (previewText) {
        clipboard.writeText(previewText);
      }

      await this.windowManager.showTranscriptionPreview(previewText);
      return { shown: true, autoHideMs: this.windowManager.getTranscriptionPreviewAutoHideMs() };
    });

    ipcMain.handle("hide-dictation-preview", async () => {
      this.windowManager.hideTranscriptionPreview();
      return { success: true };
    });

    ipcMain.handle("write-clipboard", async (_event, text) => {
      clipboard.writeText(typeof text === "string" ? text : "");
      return { success: true };
    });

    ipcMain.handle("get-preview-state", async () => {
      return { success: true, ...this.windowManager.getTranscriptionPreviewState() };
    });

    ipcMain.handle("resize-transcription-preview-window", async (_event, width, height) => {
      return this.windowManager.resizeTranscriptionPreview(width, height);
    });
  }
}

module.exports = IPCHandlersMinimal;
