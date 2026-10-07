import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { semanticColors } from '@/lib/two-face-colors';

interface Chunk {
  text: string;
  delay: number;
}

// Delay between each chunk's fade-in when several land in the same update, so a big buffered
// delta reveals word-by-word instead of all at once.
const STAGGER_SECONDS = 0.07;

/**
 * Splits `value` into pieces at internal whitespace runs — each run of whitespace stays attached
 * to the chunk before it, so streaming text lands roughly one word per chunk instead of one giant
 * blob. Whitespace at the very start or end doesn't force a split of its own.
 */
function splitIntoChunks(value: string): string[] {
  const tokens = value.split(/(\s+)/).filter(Boolean);
  const result: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (current === '') {
        current = token;
      } else {
        result.push(current + token);
        current = '';
      }
    } else {
      current += token;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}

interface SimulatedTextStreamProps {
  /**
   * Blur amount in px
   */
  blur?: number;
  /**
   * Scale factor for the text
   */
  scale?: number;
  /**
   * Initial color of the text
   */
  initialColor?: string;
  /**
   * Final color of the text
   */
  finalColor?: string;
  children: string;
}

/**
 * Renders `text` as a list of spans — each time `text` grows, the newly appended portion is split
 * into whitespace-delimited chunks and appended as new spans, while previously rendered chunks are
 * left untouched. Lets a caller target just the newest chunks (e.g. to animate them in) without
 * re-touching earlier ones.
 */
export function SimulatedTextStream({
  children,
  blur = 20,
  scale = 1.5,
  initialColor,
  finalColor,
}: SimulatedTextStreamProps) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const previousTextRef = useRef('');
  // Absolute time (seconds) at which the next chunk's stagger would start. Lets a burst of
  // chunks that arrives before the prior burst's stagger has finished playing continue that
  // same sequence, rather than every burst restarting its delay from zero. Reading the clock has
  // to happen in an effect rather than during render (render must stay pure), and a layout effect
  // specifically so the correctly-delayed chunks land before the browser paints — otherwise
  // there'd be a visible flash of the un-delayed text first.
  const cursorRef = useRef(0);
  const text = children;

  useLayoutEffect(() => {
    const previousText = previousTextRef.current;
    if (text === previousText) {
      return;
    }
    const isAppend = text.startsWith(previousText);
    const delta = isAppend ? text.slice(previousText.length) : text;
    const now = performance.now() / 1000;
    const startDelay = Math.max(0, cursorRef.current - now);
    const additions = splitIntoChunks(delta).map((chunkText, i) => ({
      text: chunkText,
      delay: startDelay + i * STAGGER_SECONDS,
    }));
    cursorRef.current = now + startDelay + additions.length * STAGGER_SECONDS;
    previousTextRef.current = text;
    setChunks((prev) => (isAppend ? [...prev, ...additions] : additions));
  }, [text]);

  return (
    <>
      {chunks.map((chunk, index) => (
        <motion.span
          key={index}
          initial={{
            scale: scale,
            opacity: 0,
            filter: `blur(${blur}px)`,
            color: initialColor,
          }}
          animate={{
            scale: 1,
            opacity: 1,
            filter: 'blur(0px)',
            color: finalColor ?? semanticColors.fg2.dark,
          }}
          transition={{ duration: 0.5, delay: chunk.delay }}
        >
          {chunk.text}
        </motion.span>
      ))}
    </>
  );
}
