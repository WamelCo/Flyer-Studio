-- ─────────────────────────────────────────────────────────────────────────────
-- Accounts by phone number (WhatsApp first). A WhatsApp number is an account the moment it
-- messages the studio; every number gets 3 free flyers once, ever; a web account that later
-- proves the number absorbs the WhatsApp account (merge_accounts).
-- ─────────────────────────────────────────────────────────────────────────────

-- Welcome flyers: once per phone number, recorded in free_flyer_grants (which outlives accounts).
create function public.grant_welcome_flyers(p_user uuid, p_phone text)
returns integer
language plpgsql
as $$
declare
  v_flyers constant integer := 3;
begin
  if p_phone is null then
    return 0;
  end if;
  insert into public.free_flyer_grants (phone, user_id, flyers) values (p_phone, p_user, v_flyers)
  on conflict (phone) do nothing;
  if not found then
    return 0;
  end if;
  update public.profiles set free_flyers = free_flyers + v_flyers where id = p_user;
  return v_flyers;
end;
$$;
--> statement-breakpoint

-- New users get their profile (as before) and, with a verified number, the welcome flyers.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  if new.phone_number is not null and new.phone_number_verified then
    perform public.grant_welcome_flyers(new.id, new.phone_number);
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger on_user_phone_verified after update of phone_number, phone_number_verified on public."user"
  for each row when (new.phone_number is not null and new.phone_number_verified) execute function public.handle_new_user();
--> statement-breakpoint

-- Spend one free flyer: the number left, or -1 when there are none (never below zero).
create function public.use_free_flyer(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_left integer;
begin
  update public.profiles set free_flyers = free_flyers - 1
   where id = p_user and free_flyers > 0
  returning free_flyers into v_left;
  if not found then
    return -1;
  end if;
  return v_left;
end;
$$;
--> statement-breakpoint
create function public.return_free_flyer(p_user uuid)
returns integer
language sql
as $$
  update public.profiles set free_flyers = free_flyers + 1 where id = p_user returning free_flyers;
$$;
--> statement-breakpoint

-- The stale-job sweep also gives back a free flyer a dead job used.
create or replace function public.fail_stale_generation_jobs()
returns integer
language plpgsql
as $$
declare
  v_job record;
  v_count integer := 0;
begin
  for v_job in
    select id, user_id, credits_spent, free_flyer
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
    if v_job.free_flyer then
      perform public.return_free_flyer(v_job.user_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
--> statement-breakpoint

-- A pass granted by the studio (not bought): same rules as fulfil_payment, credits keyed by p_key.
create function public.grant_pass(p_user uuid, p_plan public.plan_tier, p_interval public.billing_interval, p_credits integer, p_key text)
returns table (balance integer, plan public.plan_tier, period_end timestamptz)
language plpgsql
as $$
declare
  v_profile public.profiles;
  v_start timestamptz;
  v_end timestamptz;
  v_balance integer;
begin
  if p_plan = 'free' then
    raise exception 'INVALID_PLAN' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_user for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_start := case when v_profile.plan = p_plan and v_profile.current_period_end > now() then v_profile.current_period_end else now() end;
  v_end := v_start + case p_interval when 'year' then interval '1 year' else interval '1 month' end;
  update public.profiles set plan = p_plan, billing_interval = p_interval, current_period_end = v_end where id = p_user;
  v_balance := public.add_credits(p_user, p_credits, 'grant:' || p_plan || ':' || p_interval, p_key);
  return query select v_balance, p_plan, v_end;
end;
$$;
--> statement-breakpoint

-- Folds one account into another (a web account proving a WhatsApp number): everything the
-- first owns moves, balances add up, the later-ending active pass wins, and the number moves
-- with it. The first account is deleted. One transaction; both profiles locked.
create function public.merge_accounts(p_from uuid, p_into uuid)
returns void
language plpgsql
as $$
declare
  v_from public.profiles;
  v_into public.profiles;
  v_phone text;
begin
  if p_from = p_into then
    return;
  end if;
  select * into v_from from public.profiles where id = p_from for update;
  select * into v_into from public.profiles where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.flyer_projects set user_id = p_into where user_id = p_from;
  update public.generation_jobs set user_id = p_into where user_id = p_from;
  update public.exports set user_id = p_into where user_id = p_from;
  update public.payments set user_id = p_into where user_id = p_from;
  update public.ai_generation_logs set user_id = p_into where user_id = p_from;
  update public.credit_ledger set user_id = p_into where user_id = p_from;
  update public.free_flyer_grants set user_id = p_into where user_id = p_from;
  delete from public.whatsapp_chats where user_id = p_from;

  update public.profiles set
    credits = v_into.credits + v_from.credits,
    free_flyers = v_into.free_flyers + v_from.free_flyers,
    plan = case when v_from.plan <> 'free' and v_from.current_period_end > coalesce(v_into.current_period_end, '-infinity') then v_from.plan else v_into.plan end,
    billing_interval = case when v_from.plan <> 'free' and v_from.current_period_end > coalesce(v_into.current_period_end, '-infinity') then v_from.billing_interval else v_into.billing_interval end,
    current_period_end = case when v_from.plan <> 'free' and v_from.current_period_end > coalesce(v_into.current_period_end, '-infinity') then v_from.current_period_end else v_into.current_period_end end
  where id = p_into;

  select phone_number into v_phone from public."user" where id = p_from;
  delete from public."user" where id = p_from; -- cascades its (now empty) profile and sessions
  if v_phone is not null then
    update public."user" set phone_number = v_phone, phone_number_verified = true, updated_at = now() where id = p_into;
  end if;
end;
$$;
--> statement-breakpoint

-- Numbers already verified before this migration get their welcome flyers too.
select public.grant_welcome_flyers(id, phone_number) from public."user" where phone_number is not null and phone_number_verified;
