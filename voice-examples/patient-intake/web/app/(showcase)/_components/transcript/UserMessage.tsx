import { SimulatedTextStream } from './SimulatedTextStream';

interface UserMessageProps {
  message: string;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <p className="bg-bg2 text-fg0 rounded-2xl px-4 py-2 text-sm leading-relaxed lg:ml-12">
        <SimulatedTextStream blur={2}>{message}</SimulatedTextStream>
      </p>
    </div>
  );
}
