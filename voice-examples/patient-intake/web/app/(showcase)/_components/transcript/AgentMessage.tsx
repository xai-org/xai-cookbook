import { getMoodColor } from '../utils';
import { SimulatedTextStream } from './SimulatedTextStream';

interface AgentMessageProps {
  message: string;
  expression: string;
}

export function AgentMessage({ expression, message }: AgentMessageProps) {
  const moodColor = expression ? getMoodColor(expression) : undefined;
  return (
    <p className="text-fg1 text-sm leading-relaxed lg:mr-12">
      <SimulatedTextStream initialColor={moodColor}>{message}</SimulatedTextStream>
    </p>
  );
}
