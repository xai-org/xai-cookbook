import type { Suggestion } from '@/app/(showcase)/_components/suggestions';
import { Button } from '@/components/bytes';

interface SuggestionsProps {
  suggestions: Suggestion[];
  handleSuggestionClick: (suggestion: Suggestion) => void;
}

export function Suggestions({ suggestions, handleSuggestionClick }: SuggestionsProps) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pl-14">
      {suggestions.map((suggestion, index) => (
        <span
          key={suggestion.label}
          className="animate-in fade-in-0 slide-in-from-bottom-2 inline-flex duration-300"
          style={{ animationDelay: `${index * 120}ms`, animationFillMode: 'both' }}
        >
          <Button variant="secondary" size="sm" onClick={() => handleSuggestionClick(suggestion)}>
            {suggestion.label}
          </Button>
        </span>
      ))}
    </div>
  );
}
