export interface AgentMetadata {
  name: string;
  title: string;
  description: string;
  headlineModel?: string;
  models: string[];
  repoUrl?: string;
  comingSoon: boolean;
}

/** Converts a URL slug (`patient-intake`) to a canonical agent name (`patient_intake`). */
export function agentNameFromSlug(slug: string): string {
  return slug.replace(/-/g, '_');
}

/** Converts a canonical agent name (`patient_intake`) to a URL slug (`patient-intake`). */
export function slugFromAgentName(agentName: string): string {
  return agentName.replace(/_/g, '-');
}

/** Resolves a URL slug to its agent metadata, excluding agents that aren't live yet. */
export function resolveActiveAgent(slug: string): AgentMetadata | undefined {
  const agent = AGENTS.find((a) => a.name === agentNameFromSlug(slug));
  return agent && !agent.comingSoon ? agent : undefined;
}

// One entry per agent this deployment offers. Adding another agent here is most of the work of
// putting it on the page — it also needs an entry in the dispatch allowlist in
// app/api/agent/connection_details/route.ts, and optionally an accent in agent-themes.ts.
export const AGENTS: AgentMetadata[] = [
  {
    name: 'patient_intake',
    title: 'Patient Intake',
    description:
      'A family-medicine front-desk agent. Identifies callers against a chart, books and moves appointments, collects pre-visit clinical intake, and triages red-flag symptoms to emergency care',
    headlineModel: 'Grok 4.20',
    models: ['xAI Speech to Text', 'Grok 4.20', 'xAI Text to Speech'],
    comingSoon: false,
  },
];
