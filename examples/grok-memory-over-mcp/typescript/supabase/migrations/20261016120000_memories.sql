create extension if not exists vector with schema extensions;

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now()
);

create index memories_user_id_created_at_idx on public.memories (user_id, created_at desc);

alter table public.memories enable row level security;

create policy "Users read their own memories" on public.memories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their own memories" on public.memories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete their own memories" on public.memories
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.memories from anon, authenticated;
grant select, insert, delete on public.memories to authenticated;

create function public.match_memories(query_embedding extensions.vector(384), match_count int default 5)
returns table (id uuid, content text, created_at timestamptz, similarity double precision)
language sql stable security invoker set search_path = ''
as $$
  select m.id, m.content, m.created_at,
         1 - (m.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.memories m
  where m.user_id = (select auth.uid())
  order by m.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_memories(extensions.vector, int) from public, anon;
grant execute on function public.match_memories(extensions.vector, int) to authenticated;
