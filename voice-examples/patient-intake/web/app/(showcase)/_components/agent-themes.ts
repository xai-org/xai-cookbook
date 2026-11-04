import { type CSSProperties } from 'react';

/**
 * Per-agent accent color. Re-themes the agent experience by overriding the `fgAccentPrimary1`
 * token's CSS variable (visualizer, glow, accented copy).
 */
export interface AgentAccentTheme {
  accentColorVar: string;
}

export const DEFAULT_AGENT_THEME: AgentAccentTheme = {
  accentColorVar: 'var(--lk-color-cyan-400)',
};

// Agents absent from this map keep the default accent. Values must come from the
// semantic token layer (`--lk-color-green`, not `--lk-color-green-500`) so each
// accent tracks `data-lk-theme` the way the token it replaces does — the semantic
// greens sit light on dark and deep on light.
const agentThemes: Record<string, AgentAccentTheme> = {
  patient_intake: {
    accentColorVar: 'var(--lk-color-green)',
  },
};

export function getAgentTheme(agentName?: string | null): AgentAccentTheme {
  if (agentName) {
    const theme = agentThemes[agentName];
    if (theme) {
      return theme;
    }
  }
  return DEFAULT_AGENT_THEME;
}

/**
 * Inline style that re-themes one agent's accent, or undefined to leave the default accent
 * alone. Apply it to a wrapper: everything accent-derived resolves
 * `--lk-color-fgAccentPrimary1` lazily at the element that paints it — Tailwind's
 * `--color-fgAccentPrimary1` behind `bg-fgAccentPrimary1`, and the visualizer cell glow's
 * `--agent-accent-glow` (see styles/tailwind.css) — so overriding it here re-themes every
 * descendant without either of them knowing about per-agent themes.
 */
export function agentAccentStyle(
  agentName?: string | null,
): (CSSProperties & Record<`--${string}`, string>) | undefined {
  const theme = getAgentTheme(agentName);
  return theme === DEFAULT_AGENT_THEME
    ? undefined
    : { '--lk-color-fgAccentPrimary1': theme.accentColorVar };
}
