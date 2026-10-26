-- Each row is one video job. Users can read their own rows and queue new ones. Every other
-- column belongs to the worker, which uses the secret key.

create table public.budgets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cap_usd numeric(10, 2) not null default 3.00 check (cap_usd >= 0),
  created_at timestamptz not null default now()
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 2000),
  source_path text,                                   -- optional image in the sources bucket: <user_id>/<file>
  duration_seconds integer not null default 6 check (duration_seconds between 1 and 15),
  resolution text not null default '480p' check (resolution in ('480p', '720p')),
  status text not null default 'queued' check (status in ('queued', 'starting', 'running', 'done', 'failed')),
  request_id text unique,                             -- the API's id for the render
  progress integer not null default 0 check (progress between 0 and 100),
  estimated_usd numeric(10, 4) not null default 0,    -- set by the insert trigger, reserved against the cap
  cost_usd numeric(10, 4),                            -- what the API reported
  billable_usd numeric(10, 4) generated always as (
    case when cost_usd is not null then cost_usd when status = 'failed' then 0 else estimated_usd end
  ) stored,                                           -- what counts against the cap
  video_path text,                                    -- in the videos bucket: <user_id>/<id>.mp4
  error text,
  lease_until timestamptz,                            -- a worker run holds the row until then
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index generations_user_id_created_at_idx on public.generations (user_id, created_at desc);
create index generations_active_idx on public.generations (status, created_at)
  where status in ('queued', 'starting', 'running');

-- Users read their rows and insert only the four columns they choose. Everything else is the worker's.
revoke all on public.generations, public.budgets from anon, authenticated;
grant select on public.generations, public.budgets to authenticated;
grant insert (prompt, source_path, duration_seconds, resolution) on public.generations to authenticated;

alter table public.generations enable row level security;
alter table public.budgets enable row level security;
create policy "Users see their own generations" on public.generations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users queue their own generations" on public.generations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users see their own budget" on public.budgets
  for select to authenticated using ((select auth.uid()) = user_id);

-- A rough price per second, kept on the high side. It's held against the cap until the real cost arrives.
create function public.estimate_video_usd(duration_seconds integer, resolution text)
returns numeric language sql immutable set search_path = '' as $$
  select duration_seconds * case resolution when '720p' then 0.15 else 0.10 end
$$;
revoke execute on function public.estimate_video_usd(integer, text) from public, anon;
grant execute on function public.estimate_video_usd(integer, text) to authenticated, service_role;

-- Runs before every insert: prices the job, checks the source image belongs to the user,
-- and rejects the job if it would take the user past their cap.
create function public.check_generation_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap numeric;
  spent numeric;
begin
  new.estimated_usd := public.estimate_video_usd(new.duration_seconds, new.resolution);
  -- The worker reads the image with the secret key, so check the folder here. One plain file name
  -- after the user's folder, so a path like '<you>/../<someone else>/x.jpg' can't reach another folder.
  if new.source_path is not null and new.source_path !~ ('^' || new.user_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$') then
    raise exception 'The source image has to be in your own folder' using errcode = '42501';
  end if;
  insert into public.budgets (user_id) values (new.user_id) on conflict (user_id) do nothing;
  -- Locking the budget row serializes one user's inserts, so two at once can't both slip under the cap.
  select b.cap_usd into cap from public.budgets b where b.user_id = new.user_id for update;
  select coalesce(sum(g.billable_usd), 0) into spent from public.generations g where g.user_id = new.user_id;
  if spent + new.estimated_usd > cap then
    raise exception 'Spend cap reached: $% of your $% cap is used or reserved, and this video needs about $%.',
      to_char(spent, 'FM990.00'), to_char(cap, 'FM990.00'), to_char(new.estimated_usd, 'FM990.00')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger check_generation_insert before insert on public.generations
  for each row execute function public.check_generation_insert();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_updated_at before update on public.generations
  for each row execute function public.touch_updated_at();

-- Every new user gets a budget row, so the page can show the cap before the first job.
create function public.create_budget_for_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin insert into public.budgets (user_id) values (new.id) on conflict do nothing; return new; end $$;
create trigger create_budget_for_new_user after insert on auth.users
  for each row execute function public.create_budget_for_new_user();

revoke execute on function public.check_generation_insert(), public.touch_updated_at(),
  public.create_budget_for_new_user() from public, anon, authenticated;

-- Live updates: Realtime sends each user only the rows RLS lets them read.
alter publication supabase_realtime add table public.generations;
