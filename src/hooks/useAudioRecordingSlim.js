import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManagerSlim from "../helpers/audioManagerSlim";

const getApi = () => window.electronAPI;

const ERROR_MESSAGE_KEYS = {
  "No audio captured — hold the hotkey a bit longer": "overlay.errors.noAudio",
  "No speech detected": "overlay.errors.noSpeech",
  "Could not access microphone": "overlay.errors.micAccess",
  "Whisper model not configured": "overlay.errors.modelNotConfigured",
  "Transcription failed": "overlay.errors.transcriptionFailed",
  "Microphone Error": "overlay.errors.microphone",
  "Transcription Error": "overlay.errors.transcription",
};

function translateErrorMessage(t, message) {
  if (!message) return t("overlay.errors.transcription");
  const key = ERROR_MESSAGE_KEYS[message];
  if (key) return t(key);
  if (message.includes("Whisper model")) return t("overlay.errors.modelNotConfigured");
  return message;
}

export const useAudioRecordingSlim = (options = {}) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPhase, setProcessingPhase] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [progress, setProgress] = useState(null);
  const audioManagerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const progressClearTimerRef = useRef(null);
  const transcribeStartedAtRef = useRef(0);
  const expectedTranscribeMsRef = useRef(2500);
  const formatStartedAtRef = useRef(0);
  const expectedFormatMsRef = useRef(1500);
  const startLockRef = useRef(false);
  const stopLockRef = useRef(false);
  const { onToggle } = options;

  const performStartRecording = useCallback(async () => {
    if (startLockRef.current) return false;
    startLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;
      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isProcessing || currentState.isStarting) {
        return false;
      }

      if (!audioManagerRef.current.sttConfig) {
        const config = await getApi()?.getSttConfig?.();
        if (config?.success) {
          audioManagerRef.current.setSttConfig(config);
        }
      }

      setStatusMessage(null);
      setProcessingPhase(null);
      setIsProcessing(false);
      setAnalyser(null);
      getApi()?.showDictationPanel?.();
      return await audioManagerRef.current.startRecording();
    } finally {
      startLockRef.current = false;
    }
  }, []);

  const performStopRecording = useCallback(async () => {
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;
      return audioManagerRef.current.stopRecording();
    } finally {
      stopLockRef.current = false;
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    if (!audioManagerRef.current) return;
    const state = audioManagerRef.current.getState();
    if (state.isProcessing || state.isStarting) return;
    if (!state.isRecording) {
      await performStartRecording();
    } else {
      await performStopRecording();
    }
  }, [performStartRecording, performStopRecording]);

  // Whisper reports no progress, so the percentage is paced by how long the previous
  // run actually took. The ring covers the whole pipeline — transcription *and* the
  // formatting pass — otherwise it freezes near the end and looks like a hang.
  const beginProgress = useCallback(() => {
    // A leftover "hide the ring" timer from the previous run would blank a fresh one.
    if (progressClearTimerRef.current) {
      window.clearTimeout(progressClearTimerRef.current);
      progressClearTimerRef.current = null;
    }
    if (progressTimerRef.current) return;
    transcribeStartedAtRef.current = Date.now();
    const expected = Math.max(800, expectedTranscribeMsRef.current + expectedFormatMsRef.current);
    setProgress(0);
    progressTimerRef.current = window.setInterval(() => {
      const ratio = (Date.now() - transcribeStartedAtRef.current) / expected;
      // Past the estimate keep creeping instead of freezing at 95%: a stuck ring
      // reads as a hang even while the pipeline is still working.
      const pct = ratio <= 1 ? ratio * 95 : Math.min(99, 95 + (ratio - 1) * 8);
      setProgress(Math.round(pct));
    }, 120);
  }, []);

  // The first run has no measured history, so seed from the model: a phrase costs a
  // couple of seconds on `base` and tens of seconds on `turbo`/`large`.
  const seedExpectedDuration = useCallback((modelPath) => {
    const name = String(modelPath || "").toLowerCase();
    if (!name) return;
    if (name.includes("base")) expectedTranscribeMsRef.current = 2000;
    else if (name.includes("small")) expectedTranscribeMsRef.current = 6000;
    else if (name.includes("medium")) expectedTranscribeMsRef.current = 14000;
    else expectedTranscribeMsRef.current = 20000;
  }, []);

  const noteFormattingPhase = useCallback(() => {
    formatStartedAtRef.current = Date.now();
    if (!transcribeStartedAtRef.current) return;
    const elapsed = Date.now() - transcribeStartedAtRef.current;
    if (elapsed > 300) expectedTranscribeMsRef.current = elapsed;
  }, []);

  const endProgress = useCallback((completed) => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    const formattingRan = formatStartedAtRef.current > 0;

    if (formatStartedAtRef.current) {
      const elapsed = Date.now() - formatStartedAtRef.current;
      formatStartedAtRef.current = 0;
      if (elapsed > 300) expectedFormatMsRef.current = elapsed;
    }
    if (transcribeStartedAtRef.current) {
      const elapsed = Date.now() - transcribeStartedAtRef.current;
      transcribeStartedAtRef.current = 0;
      // When formatting ran, noteFormattingPhase() already recorded the transcription
      // segment — the elapsed measured here spans the whole pipeline and would
      // overstate it, which throws the next estimate off.
      if (!formattingRan && elapsed > 300) expectedTranscribeMsRef.current = elapsed;
    }

    if (!completed) {
      setProgress(null);
      return;
    }

    setProgress(100);
    progressClearTimerRef.current = window.setTimeout(() => {
      progressClearTimerRef.current = null;
      setProgress(null);
    }, 400);
  }, []);

  useEffect(() => {
    const api = getApi();
    if (!api) return undefined;

    audioManagerRef.current = new AudioManagerSlim();

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording: recording, isProcessing: processing, phase }) => {
        setIsRecording(recording);

        if (processing) {
          setIsProcessing(true);
          setProcessingPhase(phase || "transcribing");
          setAnalyser(null);
          if (phase === "transcribing") beginProgress();
          else if (phase === "formatting") noteFormattingPhase();
        } else if (recording) {
          setIsProcessing(false);
          setProcessingPhase(null);
          setAnalyser(audioManagerRef.current?.getAnalyser() || null);
        } else {
          setIsProcessing(false);
          setAnalyser(null);
        }

        if (phase === "transcribing" || phase === "formatting") {
          setStatusMessage(null);
        } else if (recording) {
          setStatusMessage(null);
        }
      },
      onError: (error) => {
        endProgress(false);
        const message = translateErrorMessage(t, error?.description || error?.title);
        setStatusMessage(message);
        setIsProcessing(false);
        setProcessingPhase(null);
        setAnalyser(null);
        console.error(error);
        getApi()?.showDictationPanel?.();
        setTimeout(() => setStatusMessage(null), 2500);
      },
      onTranscriptionComplete: async (result) => {
        endProgress(!!result.success);
        if (!result.success) return;
        const text = result.text?.trim();
        if (!text) {
          setStatusMessage(t("overlay.noSpeech"));
          setIsProcessing(false);
          setProcessingPhase(null);
          getApi()?.showDictationPanel?.();
          setTimeout(() => setStatusMessage(null), 2000);
          return;
        }

        setIsProcessing(true);

        // Preferred path: show the text in its own window — main copies it to the clipboard
        // at the same time, so nothing is lost. Pasting stays as a fallback for when the
        // result window is switched off in config.
        const preview = await getApi()?.showDictationPreview?.(text);
        if (preview?.shown) {
          getApi()?.showDictationPanel?.();
          setTimeout(() => {
            setIsProcessing(false);
            setProcessingPhase(null);
          }, 420);
          return;
        }

        setProcessingPhase("pasting");
        const pasteResult = await audioManagerRef.current.safePaste(text, {
          autoDetectFocus: true,
        });
        if (pasteResult?.mode !== "paste") {
          setStatusMessage(t("overlay.copiedToClipboard"));
        }
        getApi()?.showDictationPanel?.();
        setTimeout(() => {
          setIsProcessing(false);
          setProcessingPhase(null);
          if (pasteResult?.mode === "clipboard") {
            setTimeout(() => setStatusMessage(null), 2200);
          }
        }, 420);
      },
    });

    api.getSttConfig?.().then((config) => {
      if (config?.success && audioManagerRef.current) {
        audioManagerRef.current.setSttConfig(config);
        seedExpectedDuration(config.modelPath);
      }
    });

    const handleToggle = async () => {
      await toggleRecording();
    };

    const disposeToggle = api.onToggleDictation(() => {
      void handleToggle();
      onToggle?.();
    });
    const disposeStart = api.onStartDictation?.(() => {
      void performStartRecording();
      onToggle?.();
    });
    const disposeStop = api.onStopDictation?.(() => {
      void performStopRecording();
      onToggle?.();
    });

    return () => {
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (progressClearTimerRef.current) {
        window.clearTimeout(progressClearTimerRef.current);
        progressClearTimerRef.current = null;
      }
    };
  }, [onToggle, performStartRecording, performStopRecording, toggleRecording, t, beginProgress, noteFormattingPhase, endProgress, seedExpectedDuration]);

  return {
    isRecording,
    isProcessing,
    processingPhase,
    statusMessage,
    progress,
    analyser,
    toggleRecording,
    startRecording: performStartRecording,
    stopRecording: performStopRecording,
  };
};
