create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Claims up to max_rows queued jobs. SKIP LOCKED means two overlapping runs never get the
-- same row, and 'starting' means it can never be claimed again. A job is started at most once,
-- because a second start would be billed twice.
create function public.claim_queued_generations(max_rows integer)
returns setof public.generations language sql set search_path = '' as $$
  update public.generations g
     set status = 'starting', lease_until = now() + interval '2 minutes'
   where g.id in (
     select q.id from public.generations q
      where q.status = 'queued'
      order by q.created_at
      limit max_rows
      for update skip locked)
  returning g.*
$$;

-- Claims running jobs to check on. The lease keeps them away from other runs until this run
-- clears it, or until it expires because the run died.
create function public.claim_running_generations(max_rows integer)
returns setof public.generations language sql set search_path = '' as $$
  update public.generations g
     set lease_until = now() + interval '2 minutes'
   where g.id in (
     select r.id from public.generations r
      where r.status = 'running' and (r.lease_until is null or r.lease_until < now())
      order by r.started_at
      limit max_rows
      for update skip locked)
  returning g.*
$$;

-- A run that died after claiming a job may already have started it at the API. That job
-- isn't retried. It counts as billed. Running jobs older than 30 minutes are given up too.
create function public.fail_stuck_generations()
returns integer language plpgsql set search_path = '' as $$
declare
  stuck integer;
  stale integer;
begin
  update public.generations
     set status = 'failed', lease_until = null, finished_at = now(), cost_usd = estimated_usd,
         error = 'The worker stopped while starting this video. It may still have been billed, so it was not retried.'
   where status = 'starting' and lease_until < now();
  get diagnostics stuck = row_count;
  update public.generations
     set status = 'failed', lease_until = null, finished_at = now(), cost_usd = estimated_usd,
         error = 'Gave up after 30 minutes without a finished video.'
   where status = 'running' and started_at < now() - interval '30 minutes'
     and (lease_until is null or lease_until < now());
  get diagnostics stale = row_count;
  return stuck + stale;
end $$;

-- Stores where pg_cron should send worker runs, and the key to send, in Vault.
-- npm run supabase:start calls this locally. On a hosted project, call it once from the SQL editor.
create function public.configure_worker(worker_url text, worker_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  secret record;
begin
  for secret in select * from (values ('imagine_worker_url', worker_url), ('imagine_worker_key', worker_key)) as s(name, value) loop
    if exists (select 1 from vault.secrets where name = secret.name) then
      perform vault.update_secret((select id from vault.secrets where name = secret.name), secret.value);
    else
      perform vault.create_secret(secret.value, secret.name);
    end if;
  end loop;
end $$;

revoke execute on function public.claim_queued_generations(integer), public.claim_running_generations(integer),
  public.fail_stuck_generations(), public.configure_worker(text, text) from public, anon, authenticated;
grant execute on function public.claim_queued_generations(integer), public.claim_running_generations(integer),
  public.fail_stuck_generations(), public.configure_worker(text, text) to service_role;

-- Every 10 seconds, wake the worker, but only when there's something to do.
select cron.schedule('imagine-worker', '10 seconds', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'imagine_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'imagine_worker_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000)
  where exists (select 1 from public.generations where status in ('queued', 'starting', 'running'))
$cron$);

-- A 10-second schedule writes about 8,600 history rows a day, so keep one day.
select cron.schedule('imagine-worker-purge-history', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 day'$$);
