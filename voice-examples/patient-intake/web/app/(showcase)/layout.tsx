import { AgentShowcase } from './_components/AgentShowcase';

// AgentShowcase renders here, not in [[...name]]/page.tsx, because layouts persist across
// client-side navigations within their subtree while pages remount on every navigation — even
// within the same dynamic segment template. AgentShowcase must not remount when moving between
// the grid and a conversation, since that tears down and re-establishes the live LiveKit room
// connection.
//
// `children` (the page) still has to be rendered here, even though the page itself always
// renders null: Next only turns a page's `redirect()` call into an actual response if the layout
// renders `children` somewhere — an unrendered child's redirect is silently dropped. A parent
// layout also doesn't receive a child dynamic segment's params (Next only scopes params down to
// the segment that defines them), so slug validation/redirect can't live here anyway — see
// [[...name]]/page.tsx.
export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return <AgentShowcase />;
}
