import React from "react";
import { useProcessingAnimation } from "../hooks/useProcessingAnimation";
import { VoiceEqualizer } from "./VoiceEqualizer";

type ProcessingPhase = "transcribing" | "formatting" | "pasting" | null;

type ProcessingIndicatorProps = {
  phase: ProcessingPhase;
  active: boolean;
  maxHeightPx?: number;
};

export function ProcessingIndicator({ phase, active, maxHeightPx = 16 }: ProcessingIndicatorProps) {
  const levels = useProcessingAnimation(phase, active);

  return <VoiceEqualizer levels={levels} maxHeightPx={maxHeightPx} className="px-1.5" />;
}
