-- ─────────────────────────────────────────────────────────────────────────────
-- Functions and triggers (ported from the Supabase migrations, minus RLS and roles:
-- the app connects as one role and scopes every query to the signed-in user).
--   * every new user gets a Free profile with 0 credits (trigger on "user")
--   * credits change ONLY through deduct_credits / add_credits / fulfil_payment
--   * every credit movement is an idempotent ledger row
-- ─────────────────────────────────────────────────────────────────────────────

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();
--> statement-breakpoint
create trigger flyer_projects_touch_updated_at before update on public.flyer_projects
  for each row execute function public.touch_updated_at();
--> statement-breakpoint
create trigger whatsapp_chats_touch_updated_at before update on public.whatsapp_chats
  for each row execute function public.touch_updated_at();
--> statement-breakpoint

-- Every new user (Better Auth) gets a Free profile with 0 credits; email changes follow.
create function public.handle_new_user()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
--> statement-breakpoint
create trigger on_user_created after insert on public."user"
  for each row execute function public.handle_new_user();
--> statement-breakpoint
create trigger on_user_email_changed after update of email on public."user"
  for each row when (old.email is distinct from new.email) execute function public.handle_new_user();
--> statement-breakpoint

-- ── Credits ─────────────────────────────────────────────────────────────────
-- Both functions are idempotent on p_idempotency_key: the ledger row is claimed first, so a
-- replay (or a concurrent duplicate, which blocks on the unique index until the first
-- transaction ends) returns the current balance without moving it.
create function public.deduct_credits(p_user_id uuid, p_amount integer, p_reason text, p_idempotency_key text)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, idempotency_key)
  values (p_user_id, -p_amount, 0, p_reason, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  if not found then
    select credits into v_balance from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  -- The row lock serialises concurrent deductions; the guard re-checks the balance after
  -- the lock is acquired, so parallel requests can never overdraw.
  update public.profiles
     set credits = credits - p_amount
   where id = p_user_id
     and credits >= p_amount
  returning credits into v_balance;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.credit_ledger set balance_after = v_balance where idempotency_key = p_idempotency_key;
  return v_balance;
end;
$$;
--> statement-breakpoint
create function public.add_credits(p_user_id uuid, p_amount integer, p_reason text, p_idempotency_key text)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, idempotency_key)
  values (p_user_id, p_amount, 0, p_reason, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  if not found then
    select credits into v_balance from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  update public.profiles set credits = credits + p_amount where id = p_user_id
  returning credits into v_balance;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.credit_ledger set balance_after = v_balance where idempotency_key = p_idempotency_key;
  return v_balance;
end;
$$;
--> statement-breakpoint

-- ── Retention: Free plan keeps projects for one month ────────────────────────
create function public.purge_expired_free_projects()
returns integer
language plpgsql
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
--> statement-breakpoint

-- ── Generation jobs that stopped responding ─────────────────────────────────
-- Failed after 5 quiet minutes and refunded with the app's own idempotency key, so a refund
-- the job already made is never doubled.
create function public.fail_stale_generation_jobs()
returns integer
language plpgsql
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
--> statement-breakpoint

-- ── Rate limits: fixed-window counters ──────────────────────────────────────
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
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
--> statement-breakpoint

-- ── Paynow passes: fulfilment in one transaction, exactly once ───────────────
-- Renewing the same plan before it ends extends from the current end; a new, lapsed or
-- different plan starts now. A second call for the same payment changes nothing.
create function public.fulfil_payment(p_payment_id uuid, p_paynow_reference text)
returns table (balance integer, plan public.plan_tier, period_end timestamptz, newly_paid boolean)
language plpgsql
as $$
declare
  v_payment public.payments;
  v_profile public.profiles;
  v_start timestamptz;
  v_end timestamptz;
  v_balance integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_profile from public.profiles where id = v_payment.user_id for update;

  if v_payment.status = 'paid' then
    return query select v_profile.credits, v_profile.plan, v_profile.current_period_end, false;
    return;
  end if;

  v_start := case
    when v_profile.plan = v_payment.plan and v_profile.current_period_end > now() then v_profile.current_period_end
    else now()
  end;
  v_end := v_start + case v_payment.billing_interval when 'year' then interval '1 year' else interval '1 month' end;

  update public.payments
     set status = 'paid', paid_at = now(), paynow_reference = coalesce(p_paynow_reference, paynow_reference)
   where id = p_payment_id;

  update public.profiles
     set plan = v_payment.plan, billing_interval = v_payment.billing_interval, current_period_end = v_end
   where id = v_payment.user_id;

  v_balance := public.add_credits(
    v_payment.user_id,
    v_payment.credits,
    'pass:' || v_payment.plan || ':' || v_payment.billing_interval,
    'paynow:' || p_payment_id
  );

  return query select v_balance, v_payment.plan, v_end, true;
end;
$$;
--> statement-breakpoint

-- ── Lapsed passes return to Free (credits already granted stay) ──────────────
create function public.expire_lapsed_passes()
returns integer
language sql
as $$
  with lapsed as (
    update public.profiles
       set plan = 'free', billing_interval = null
     where plan <> 'free' and current_period_end is not null and current_period_end < now()
    returning 1
  )
  select count(*)::integer from lapsed;
$$;
