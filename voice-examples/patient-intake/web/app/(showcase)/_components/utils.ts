// Shared by every layoutId'd box in the grid<->conversation morph (the outer box and the
// visualizer, in both AgentCards.tsx and AgentTranscript.tsx) so they move in lockstep instead of
// drifting apart mid-transition.
export const MORPH_SPRING = {
  type: 'spring',
  stiffness: 675,
  damping: 75,
  mass: 1,
} as const;

export function agentMorphName(agentName: string): string {
  return `agent-morph-${agentName}`;
}

/** The agent slug, or null for the bare `/` grid route. The showcase is the whole site here,
 *  so an agent sits at `/patient-intake` rather than livekit.com's `/agents/patient-intake`. */
export function slugFromPathname(pathname: string): string | null {
  return pathname === '/' ? null : pathname.replace(/^\//, '');
}

import { twoFaceColors } from '@/lib/two-face-colors';

export const MOOD_GREEN = twoFaceColors.green.dark; // happy / bright
export const MOOD_YELLOW = twoFaceColors.yellow.dark; // warmth / empathy
export const MOOD_RED = twoFaceColors.red.dark; // anger
export const MOOD_BLUE = twoFaceColors.blue.dark; // sadness
export const MOOD_TRUST = twoFaceColors.accent.dark; // trust
export const MOOD_CONFUSED = twoFaceColors.purple.dark; // confused

const MOOD_RULES: { keywords: string[]; hex: string }[] = [
  {
    keywords: ['angr', 'furious', 'irrit', 'frustrat', 'annoy', 'rage'],
    hex: MOOD_RED,
  },
  {
    keywords: ['sad', 'sorrow', 'melanchol', 'grief', 'gloom', 'despair', 'unhappy', 'mourn'],
    hex: MOOD_BLUE,
  },
  {
    keywords: [
      'happ',
      'bright',
      'cheer',
      'joy',
      'delight',
      'excit',
      'upbeat',
      'playful',
      'glad',
      'warm',
      'genuine',
    ],
    hex: MOOD_GREEN,
  },
  {
    keywords: [
      'slow',
      'trust',
      'confident',
      'certain',
      'secur',
      'convinc',
      'believ',
      'reassur',
      'patient',
      'clear',
    ],
    hex: MOOD_TRUST,
  },
  {
    keywords: [
      'soft',
      'gentl',
      'care',
      'confused',
      'nervous',
      'ambiguous',
      'doubtful',
      'indecisive',
      'genuin',
    ],
    hex: MOOD_CONFUSED,
  },
  // {
  //   keywords: [
  //     'warm',
  //     'empath',
  //     'compassion',
  //     'tender',
  //     'caring',
  //     'sooth',
  //     'reassur',
  //     'gentl',
  //     'affection',
  //   ],
  //   hex: MOOD_YELLOW,
  // },
];

/**
 * Maps a freeform `lk.expression` value (e.g. "speak happily") to a mood accent color, by scoring
 * each rule on how many of its keywords appear and returning the highest-scoring rule's color. A
 * tie goes to whichever rule comes first in `MOOD_RULES`.
 */
export function getMoodColor(expressionValue: string): string | undefined {
  const lower = expressionValue.toLowerCase();
  let bestRule: (typeof MOOD_RULES)[number] | undefined;
  let bestScore = 0;
  for (const rule of MOOD_RULES) {
    const score = rule.keywords.filter((keyword) => lower.includes(keyword)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }
  return bestRule?.hex;
}
