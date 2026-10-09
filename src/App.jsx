import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { useAudioRecordingSlim } from "./hooks/useAudioRecordingSlim";
import { useVoiceEqualizer } from "./hooks/useVoiceEqualizer";
import { VoiceEqualizer, VoiceEqualizerIdle } from "./components/VoiceEqualizer";
import { ProcessingIndicator } from "./components/ProcessingIndicator";

// Progress ring drawn around the mic button while a transcription is running.
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function App() {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const {
    isRecording,
    isProcessing,
    processingPhase,
    statusMessage,
    progress,
    analyser,
    toggleRecording,
  } = useAudioRecordingSlim();
  const equalizerLevels = useVoiceEqualizer(analyser, isRecording);

  const micState = isProcessing ? "processing" : isRecording ? "recording" : isHovered ? "hover" : "idle";

  const buttonClass =
    micState === "recording"
      ? "bg-black/78"
      : micState === "processing"
        ? "bg-black/70 cursor-wait"
        : isHovered
          ? "bg-black/62 scale-105"
          : "bg-black/50";

  const hoverHint =
    !isProcessing && !statusMessage
      ? isRecording
        ? t("overlay.clickToStop")
        : isHovered
          ? t("overlay.clickToRecord")
          : null
      : null;

  const handleOverlayClick = () => {
    if (isProcessing) return;
    void toggleRecording();
  };

  return (
    <div className="dictation-window">
      <div
        className="fixed bottom-1 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {(statusMessage || hoverHint) && (
          <div className="mb-2 w-max max-w-none rounded bg-black/80 px-2.5 py-1 text-[10px] leading-tight text-white shadow-lg pointer-events-none whitespace-nowrap">
            {statusMessage || hoverHint}
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={handleOverlayClick}
            disabled={isProcessing}
            aria-label={isRecording ? t("overlay.clickToStop") : t("overlay.clickToRecord")}
            className={`rounded-full w-10 h-10 flex items-center justify-center relative overflow-hidden transition-all duration-200 ${
              isProcessing ? "cursor-wait" : "cursor-pointer"
            } ${buttonClass}`}
          >
            {micState === "recording" ? (
              <VoiceEqualizer levels={equalizerLevels} maxHeightPx={16} className="px-1.5" />
            ) : micState === "processing" ? (
              <ProcessingIndicator phase={processingPhase} active={isProcessing} maxHeightPx={16} />
            ) : (
              <VoiceEqualizerIdle maxHeightPx={isHovered ? 14 : 12} className="px-1.5" />
            )}
          </button>

          {isProcessing && progress !== null && (
            <svg
              className="pointer-events-none absolute -inset-1 h-[48px] w-[48px]"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="24" cy="24" r="22" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
              <circle
                cx="24"
                cy="24"
                r="22"
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress / 100)}
                transform="rotate(-90 24 24)"
                style={{ transition: "stroke-dashoffset 140ms linear" }}
              />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
