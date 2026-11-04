import { useEffect, useState } from 'react';
import { type AgentState } from '@livekit/components-react';

export interface Coordinate {
  x: number;
  y: number;
}

export function generateConnectingSequence(rows: number, columns: number, _radius: number) {
  const seq = [];

  for (let x = 0; x < columns; x++) {
    if (x % 2 === 0) {
      for (let y = 0; y < rows; y++) {
        seq.push({ x, y });
      }
    } else {
      for (let y = rows - 1; y >= 0; y--) {
        seq.push({ x, y });
      }
    }
  }

  return seq;
}

export function generateListeningSequence(rows: number, columns: number) {
  const width = 3;
  const noIndex = { x: -1, y: -1 };

  // Calculate the top-left corner of the 2x2 centered block
  const startX = Math.floor(columns / 2) - Math.floor(width / 2);
  const startY = Math.floor(rows / 2) - Math.floor(width / 2);

  // Generate all coordinates in the 2x2 block
  const block: Coordinate[] = [];
  for (let dy = 0; dy < width; dy++) {
    for (let dx = 0; dx < width; dx++) {
      block.push({ x: startX + dx, y: startY + dy });
    }
  }

  // Pulse: show all 4 cells, then pause with noIndex
  return [...block, noIndex, noIndex, noIndex, noIndex, noIndex, noIndex];
}

export function generateThinkingSequence(rows: number, columns: number) {
  const seq = [];
  const y = Math.floor(rows / 2);
  for (let x = 0; x < columns; x++) {
    seq.push({ x, y });
  }
  for (let x = columns - 1; x >= 0; x--) {
    seq.push({ x, y });
  }

  return seq;
}

export function useAgentAudioVisualizerGridAnimator(
  state: AgentState,
  rows: number,
  columns: number,
  interval: number,
  radius?: number,
): Coordinate {
  const [index, setIndex] = useState(0);
  const [sequence, setSequence] = useState<Coordinate[]>(() => [
    {
      x: Math.floor(columns / 2),
      y: Math.floor(rows / 2),
    },
  ]);

  useEffect(() => {
    const clampedRadius = radius
      ? Math.min(radius, Math.floor(Math.max(rows, columns) / 2))
      : Math.floor(Math.max(rows, columns) / 2);

    if (state === 'thinking') {
      setSequence(generateThinkingSequence(rows, columns));
    } else if (state === 'connecting' || state === 'initializing') {
      const sequence = [...generateConnectingSequence(rows, columns, clampedRadius)];
      setSequence(sequence);
    } else if (state === 'listening') {
      setSequence(generateListeningSequence(rows, columns));
    } else {
      setSequence([{ x: Math.floor(columns / 2), y: Math.floor(rows / 2) }]);
    }
    setIndex(0);
  }, [state, rows, columns, radius]);

  useEffect(() => {
    if (state === 'speaking') {
      return;
    }

    const indexInterval = setInterval(() => {
      setIndex((prev) => {
        return prev + 1;
      });
    }, interval);

    return () => clearInterval(indexInterval);
  }, [interval, columns, rows, state, sequence.length]);

  return (
    sequence[index % sequence.length] ?? { x: Math.floor(columns / 2), y: Math.floor(rows / 2) }
  );
}
