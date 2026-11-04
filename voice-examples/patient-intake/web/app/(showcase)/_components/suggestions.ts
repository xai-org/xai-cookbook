export const AGENT_SUGGESTIONS_ATTRIBUTE = 'lk.agent.suggestions';
export const TEXT_INPUT_TOPIC = 'lk.chat';

export interface Suggestion {
  label: string;
  value: string;
}

export function parseSuggestions(raw: string | undefined): Suggestion[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const suggestions: Suggestion[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      'label' in item &&
      'value' in item
    ) {
      const { label, value } = item;
      if (typeof label === 'string' && typeof value === 'string') {
        suggestions.push({ label, value });
      }
    }
  }
  return suggestions;
}
