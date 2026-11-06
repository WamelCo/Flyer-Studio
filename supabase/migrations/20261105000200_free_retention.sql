-- Free plan: one month of data retention (see .claude/rules/pricing.md).
create function public.purge_expired_free_projects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.flyer_projects p
   using public.profiles pr
   where pr.id = p.user_id
     and pr.plan = 'free'
     and p.updated_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_free_projects() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'purge-expired-free-projects',
  '17 3 * * *',
  $$select public.purge_expired_free_projects()$$
);
