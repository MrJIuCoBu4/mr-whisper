import { useEffect, useRef, useState } from "react";

export const VOICE_EQUALIZER_BAR_COUNT = 5;
const CORE_BAND_COUNT = 3;

const MIN_LEVEL = 0.16;
const MAX_LEVEL = 1;
const SILENCE_THRESHOLD = 0.04;

function createBandTargets(frequencyData) {
  const binCount = frequencyData.length;
  const targets = new Float32Array(CORE_BAND_COUNT);

  for (let i = 0; i < CORE_BAND_COUNT; i += 1) {
    const startRatio = i / CORE_BAND_COUNT;
    const endRatio = (i + 1) / CORE_BAND_COUNT;
    const startBin = Math.floor(Math.pow(binCount, startRatio * 0.85 + 0.05));
    const endBin = Math.max(startBin + 1, Math.floor(Math.pow(binCount, endRatio * 0.85 + 0.05)));

    let sum = 0;
    for (let bin = startBin; bin < endBin; bin += 1) {
      sum += frequencyData[bin];
    }
    targets[i] = sum / ((endBin - startBin) * 255);
  }

  return targets;
}

function blendNeighborBands(targets) {
  const blended = new Float32Array(CORE_BAND_COUNT);
  for (let i = 0; i < CORE_BAND_COUNT; i += 1) {
    const left = i > 0 ? targets[i - 1] : targets[i];
    const right = i < CORE_BAND_COUNT - 1 ? targets[i + 1] : targets[i];
    blended[i] = targets[i] * 0.58 + left * 0.21 + right * 0.21;
  }
  return blended;
}

function mirrorLevels(coreLevels) {
  const low = coreLevels[0];
  const mid = coreLevels[1];
  const high = coreLevels[2];
  return [low, mid, high, mid, low];
}

function stepSpringPhysics(positions, velocities, targets, energyBoost) {
  const next = new Array(CORE_BAND_COUNT);

  for (let i = 0; i < CORE_BAND_COUNT; i += 1) {
    const stiffness = 0.24 + i * 0.018;
    const damping = 0.74;
    const target = MIN_LEVEL + Math.min(1, targets[i] * 1.35 + energyBoost) * (MAX_LEVEL - MIN_LEVEL);

    velocities[i] += (target - positions[i]) * stiffness;
    velocities[i] *= damping;
    positions[i] += velocities[i];

    if (positions[i] < MIN_LEVEL) {
      positions[i] = MIN_LEVEL;
      velocities[i] *= 0.35;
    } else if (positions[i] > MAX_LEVEL) {
      positions[i] = MAX_LEVEL;
      velocities[i] *= 0.5;
    }

    next[i] = positions[i];
  }

  return mirrorLevels(next);
}

export function useVoiceEqualizer(analyser, active) {
  const positionsRef = useRef(new Float32Array(CORE_BAND_COUNT).fill(MIN_LEVEL));
  const velocitiesRef = useRef(new Float32Array(CORE_BAND_COUNT).fill(0));
  const previousEnergyRef = useRef(0);
  const [levels, setLevels] = useState(() => mirrorLevels(Array(CORE_BAND_COUNT).fill(MIN_LEVEL)));

  useEffect(() => {
    if (!active || !analyser) {
      positionsRef.current.fill(MIN_LEVEL);
      velocitiesRef.current.fill(0);
      previousEnergyRef.current = 0;
      setLevels(mirrorLevels(Array(CORE_BAND_COUNT).fill(MIN_LEVEL)));
      return undefined;
    }

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    let frameId = 0;

    const tick = () => {
      analyser.getByteFrequencyData(frequencyData);

      const rawTargets = createBandTargets(frequencyData);
      const blendedTargets = blendNeighborBands(rawTargets);
      const energy = blendedTargets.reduce((sum, value) => sum + value, 0) / CORE_BAND_COUNT;
      const energyDelta = energy - previousEnergyRef.current;
      previousEnergyRef.current = energy;

      const speechOnsetBoost = energyDelta > 0.08 && energy > SILENCE_THRESHOLD ? 0.12 : 0;
      const nextLevels = stepSpringPhysics(
        positionsRef.current,
        velocitiesRef.current,
        blendedTargets,
        speechOnsetBoost
      );

      setLevels(nextLevels);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, analyser]);

  return levels;
}
