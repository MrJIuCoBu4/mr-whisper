import { isBuiltInMicrophone } from "../utils/audioDeviceUtils";

const STORAGE_KEY_MIC = "selectedMicDeviceId";
const STORAGE_KEY_PREFER_BUILTIN = "preferBuiltInMic";
const RECORDING_TIMESLICE_MS = 250;

function getMicSettings() {
  return {
    selectedMicDeviceId: localStorage.getItem(STORAGE_KEY_MIC) || "",
    preferBuiltInMic: localStorage.getItem(STORAGE_KEY_PREFER_BUILTIN) !== "false",
  };
}

export default class AudioManagerSlim {
  constructor() {
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.startInProgress = false;
    this.pendingStop = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.sttConfig = null;
    this.audioContext = null;
    this.analyser = null;
  }

  setupAnalyser(stream) {
    this.teardownAnalyser();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.audioContext = new AudioContextClass();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.68;
    this.analyser.minDecibels = -88;
    this.analyser.maxDecibels = -22;

    const sink = this.audioContext.createGain();
    sink.gain.value = 0;
    source.connect(this.analyser);
    this.analyser.connect(sink);
    sink.connect(this.audioContext.destination);

    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }
  }

  teardownAnalyser() {
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }

  getAnalyser() {
    return this.analyser;
  }

  setCallbacks(callbacks = {}) {
    this.onStateChange = callbacks.onStateChange;
    this.onError = callbacks.onError;
    this.onTranscriptionComplete = callbacks.onTranscriptionComplete;
  }

  setSttConfig(config) {
    this.sttConfig = config;
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStarting: this.startInProgress,
    };
  }

  async getAudioConstraints() {
    const { selectedMicDeviceId, preferBuiltInMic } = getMicSettings();
    const constraints = { audio: true };

    if (selectedMicDeviceId) {
      constraints.audio = { deviceId: { exact: selectedMicDeviceId } };
      return constraints;
    }

    if (preferBuiltInMic) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const builtIn = devices.find((d) => d.kind === "audioinput" && isBuiltInMicrophone(d));
        if (builtIn?.deviceId) {
          constraints.audio = { deviceId: { exact: builtIn.deviceId } };
        }
      } catch {
        // use default mic
      }
    }

    return constraints;
  }

  cleanupStream() {
    this.teardownAnalyser();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
  }

  async startRecording() {
    if (this.isRecording || this.isProcessing || this.startInProgress) return false;

    this.startInProgress = true;
    this.pendingStop = false;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(await this.getAudioConstraints());
      this.setupAnalyser(this.mediaStream);
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.cleanupStream();
        await this.processAudio(audioBlob);
      };

      this.mediaRecorder.start(RECORDING_TIMESLICE_MS);
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      if (this.pendingStop) {
        this.pendingStop = false;
        this.stopRecording();
      }

      return true;
    } catch (error) {
      this.cleanupStream();
      this.onError?.({
        title: "Microphone Error",
        description: error?.message || "Could not access microphone",
      });
      return false;
    } finally {
      this.startInProgress = false;
    }
  }

  stopRecording() {
    if (this.startInProgress) {
      this.pendingStop = true;
      return true;
    }

    if (!this.isRecording || !this.mediaRecorder) {
      return false;
    }

    this.isRecording = false;
    this.isProcessing = true;
    this.onStateChange?.({ isRecording: false, isProcessing: true, phase: "transcribing" });

    if (this.mediaRecorder.state === "recording") {
      try {
        this.mediaRecorder.requestData();
      } catch {
        // ignore
      }
      this.mediaRecorder.stop();
    }

    return true;
  }

  async processAudio(audioBlob) {
    try {
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error("No audio captured — hold the hotkey a bit longer");
      }

      if (!this.sttConfig?.modelReady) {
        throw new Error(this.sttConfig?.modelError || "Whisper model not configured");
      }

      const arrayBuffer = await audioBlob.arrayBuffer();
      const config = await window.electronAPI?.getConfig?.();
      const language =
        config?.config?.language && config.config.language !== "auto"
          ? config.config.language
          : undefined;

      const result = await window.electronAPI?.transcribeLocalWhisper?.(arrayBuffer, { language });

      if (!result?.success) {
        throw new Error(result?.error || "Transcription failed");
      }

      const rawText = result.text?.trim();
      if (!rawText) {
        throw new Error("No speech detected");
      }

      let finalText = rawText;
      const formattingConfig = await window.electronAPI?.getFormattingConfig?.();
      if (formattingConfig?.enabled && formattingConfig?.modelReady) {
        this.onStateChange?.({ isRecording: false, isProcessing: true, phase: "formatting" });
        const formatted = await window.electronAPI?.formatText?.(rawText);
        if (formatted?.success && formatted.text?.trim() && !formatted.rejected) {
          finalText = formatted.text.trim();
        } else if (formatted?.rejected || formatted?.fallback) {
          console.warn("Formatting skipped bad output, using raw transcription");
        } else if (formatted?.error) {
          console.warn("Formatting failed, using raw transcription:", formatted.error);
        }
      }

      await this.onTranscriptionComplete?.({
        success: true,
        text: finalText,
        rawText,
        source: "whisper-local",
      });
    } catch (error) {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false, phase: null });
      this.onError?.({
        title: "Transcription Error",
        description: error?.message || "Transcription failed",
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async safePaste(text, options = {}) {
    try {
      const result = await window.electronAPI?.pasteText?.(text, options);
      return result || { success: true, mode: "paste" };
    } catch (error) {
      this.onError?.({
        title: "Paste Error",
        description: error?.message || "Failed to paste text",
      });
      return false;
    }
  }
}
