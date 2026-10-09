import React from "react";
import { VOICE_EQUALIZER_BAR_COUNT } from "../hooks/useVoiceEqualizer";

type VoiceEqualizerProps = {
  levels: number[];
  className?: string;
  maxHeightPx?: number;
};

export function VoiceEqualizer({ levels, className = "", maxHeightPx = 16 }: VoiceEqualizerProps) {
  const bars = levels.length > 0 ? levels : Array(VOICE_EQUALIZER_BAR_COUNT).fill(0.16);

  return (
    <div
      className={`flex items-center justify-center gap-px ${className}`}
      style={{ height: maxHeightPx }}
    >
      {bars.map((level, index) => (
        <div
          key={index}
          className="w-px bg-white"
          style={{ height: `${Math.max(0.16, Math.min(1, level)) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function VoiceEqualizerIdle({ className = "", maxHeightPx = 14 }: { className?: string; maxHeightPx?: number }) {
  const idleLevels = [0.34, 0.52, 0.68, 0.52, 0.34];

  return (
    <div
      className={`flex items-center justify-center gap-px ${className}`}
      style={{ height: maxHeightPx }}
    >
      {idleLevels.map((level, index) => (
        <div
          key={index}
          className="w-px bg-white/75"
          style={{ height: `${level * 100}%` }}
        />
      ))}
    </div>
  );
}
