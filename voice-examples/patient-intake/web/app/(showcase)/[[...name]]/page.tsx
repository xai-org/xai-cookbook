import { redirect } from 'next/navigation';
import { resolveActiveAgent } from '../_components/agent-metadata';

// Validates the slug and redirects when invalid. The actual UI renders in ../layout.tsx (see its
// comment for why) — this component's own output is never shown.
export default async function AgentPage({ params }: { params: Promise<{ name?: string[] }> }) {
  const { name } = await params;
  const [slug, ...rest] = name ?? [];

  // Temporary redirect, not a 404: an invalid or coming-soon slug today may be a valid agent
  // tomorrow, so this shouldn't be cached as a permanent dead link.
  if (slug !== undefined && (rest.length > 0 || !resolveActiveAgent(slug))) {
    redirect('/');
  }

  return null;
}
