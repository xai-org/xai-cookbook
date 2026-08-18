import { Badge, SettingsGear1Icon } from '@/components/bytes';

interface ToolTagProps {
  name: string;
}

export function ToolTag({ name }: ToolTagProps) {
  return (
    <Badge variant="muted" size="large" leftIcon={<SettingsGear1Icon />} className="tracking-wider">
      {name.toUpperCase()}
    </Badge>
  );
}
