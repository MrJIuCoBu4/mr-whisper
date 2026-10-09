import { useEffect, useState } from "react";

import { VOICE_EQUALIZER_BAR_COUNT } from "./useVoiceEqualizer";

const MIRROR_SHAPE = [0.55, 0.78, 1, 0.78, 0.55];

function mirrorSymmetric(coreLevels) {
  return [coreLevels[0], coreLevels[1], coreLevels[2], coreLevels[1], coreLevels[0]];
}

function animateTranscribing(time) {
  const core = new Array(3);
  for (let i = 0; i < 3; i += 1) {
    const sweep = Math.sin(time * 5.2 - i * 1.35) * 0.5 + 0.5;
    const ripple = Math.sin(time * 2.4 + i * 0.8) * 0.18;
    core[i] = 0.22 + sweep * 0.62 + ripple;
  }
  return mirrorSymmetric(core);
}

function animateFormatting(time) {
  const core = new Array(3);
  const breath = Math.sin(time * 3.6) * 0.5 + 0.5;
  const shimmer = Math.sin(time * 8.5) * 0.12;
  for (let i = 0; i < 3; i += 1) {
    const focus = 1 - Math.abs(i - 1) * 0.18;
    core[i] = 0.24 + breath * focus * 0.58 + shimmer;
  }
  return mirrorSymmetric(core);
}

function animatePasting(time) {
  const core = new Array(3);
  const collapse = Math.max(0, 1 - time * 2.8);
  const flash = Math.sin(time * 14) * 0.08 * collapse;
  for (let i = 0; i < 3; i += 1) {
    const focus = 1 - Math.abs(i - 1) * 0.25;
    core[i] = 0.2 + collapse * focus * 0.72 + flash;
  }
  return mirrorSymmetric(core);
}

function applyMirrorShape(levels) {
  return levels.map((level, index) => level * MIRROR_SHAPE[index]);
}

export function useProcessingAnimation(phase, active) {
  const [levels, setLevels] = useState(() =>
    Array(VOICE_EQUALIZER_BAR_COUNT).fill(0.22)
  );

  useEffect(() => {
    if (!active || !phase) {
      setLevels(Array(VOICE_EQUALIZER_BAR_COUNT).fill(0.22));
      return undefined;
    }

    const start = performance.now();
    let frameId = 0;

    const tick = (now) => {
      const elapsed = (now - start) / 1000;
      let next;

      if (phase === "formatting") {
        next = animateFormatting(elapsed);
      } else if (phase === "pasting") {
        next = animatePasting(elapsed);
      } else {
        next = animateTranscribing(elapsed);
      }

      setLevels(applyMirrorShape(next));
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, phase]);

  return levels;
}
