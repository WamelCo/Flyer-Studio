-- Phase 0 (docs/ROADMAP.md): generation runs as a background job, requests are rate
-- limited in Postgres, and jobs that stop responding are failed and refunded.
-- Safe to re-run.

-- ── Generation jobs ─────────────────────────────────────────────────────────
-- pending → running → succeeded | failed. The client polls its own row (RLS: owner
-- read) for `stage` while the server works, then reads `result`.
alter table public.generation_jobs drop constraint if exists generation_jobs_status_check;
alter table public.generation_jobs
  add constraint generation_jobs_status_check check (status in ('pending', 'running', 'succeeded', 'failed'));

alter table public.generation_jobs
  add column if not exists stage text,
  add column if not exists result jsonb,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz,
  add column if not exists heartbeat_at timestamptz;

create index if not exists generation_jobs_active_idx
  on public.generation_jobs (heartbeat_at)
  where status in ('pending', 'running');

-- A job whose worker died (deploy, crash, timeout) is failed after 5 quiet minutes and
-- its credits returned — with the same idempotency key the app uses, so a refund the
-- worker already made is never doubled.
create or replace function public.fail_stale_generation_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_count integer := 0;
begin
  for v_job in
    select id, user_id, credits_spent
      from public.generation_jobs
     where status in ('pending', 'running')
       and coalesce(heartbeat_at, created_at) < now() - interval '5 minutes'
       for update skip locked
  loop
    update public.generation_jobs
       set status = 'failed',
           error_code = 'GENERATION_TIMEOUT',
           error_message = 'The design job stopped responding.',
           completed_at = now()
     where id = v_job.id;
    if v_job.credits_spent > 0 then
      perform public.add_credits(
        v_job.user_id,
        v_job.credits_spent,
        'refund:generate',
        'refund:generate:' || v_job.user_id::text || ':' || v_job.id::text
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fail_stale_generation_jobs() from public, anon, authenticated;

-- ── Rate limits ─────────────────────────────────────────────────────────────
-- Fixed-window counters. Service role only: no RLS policies on purpose.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return query
    select v_hits <= p_limit, greatest(p_limit - v_hits, 0), v_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ── Schedules ───────────────────────────────────────────────────────────────
-- Enabled by the free-retention migration too; repeated so this file also runs on its own.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('fail-stale-generation-jobs', 'purge-rate-limits');
select cron.schedule('fail-stale-generation-jobs', '* * * * *', $$select public.fail_stale_generation_jobs()$$);
select cron.schedule('purge-rate-limits', '23 * * * *', $$delete from public.rate_limits where window_start < now() - interval '2 days'$$);
