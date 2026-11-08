-- ─────────────────────────────────────────────────────────────────────────────
-- Rules Prisma doesn't model: check constraints and the credit ledger functions.
--   * credits change ONLY through deduct_credits / add_credits
--   * every credit movement is an idempotent ledger row
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Check constraints ────────────────────────────────────────────────────────
alter table "profiles"
  add constraint "credits_non_negative" check ("credits" >= 0);

alter table "flyer_projects"
  add constraint "flyer_projects_title_length" check (char_length("title") between 1 and 120),
  add constraint "flyer_projects_format_check" check ("format" in ('poster', 'square', 'story', 'landscape'));

alter table "generation_jobs"
  add constraint "generation_jobs_prompt_length" check (char_length("prompt") between 1 and 500),
  add constraint "generation_jobs_intent_check" check ("intent" in ('event', 'sale', 'real_estate', 'party')),
  add constraint "generation_jobs_format_check" check ("format" in ('poster', 'square', 'story', 'landscape')),
  add constraint "generation_jobs_status_check" check ("status" in ('pending', 'succeeded', 'failed'));

alter table "exports"
  add constraint "exports_format_check" check ("format" in ('png', 'pdf', 'png-2k', 'png-4k')),
  add constraint "exports_credits_spent_check" check ("credits_spent" >= 0),
  add constraint "exports_status_check" check ("status" in ('pending', 'complete', 'failed'));

-- ── Credit functions ─────────────────────────────────────────────────────────
-- Both functions are idempotent on p_idempotency_key: the ledger row is claimed
-- first, so a replay (or a concurrent duplicate, which blocks on the unique index
-- until the first transaction ends) returns the current balance without moving it.

create function deduct_credits(
  p_user_id text,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  insert into credit_ledger (user_id, delta, balance_after, reason, idempotency_key)
  values (p_user_id, -p_amount, 0, p_reason, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  if not found then
    select credits into v_balance from profiles where id = p_user_id;
    return v_balance;
  end if;

  -- The row lock serialises concurrent deductions; the guard re-checks the balance
  -- after the lock is acquired, so parallel requests can never overdraw.
  update profiles
     set credits = credits - p_amount,
         updated_at = now()
   where id = p_user_id
     and credits >= p_amount
  returning credits into v_balance;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update credit_ledger
     set balance_after = v_balance
   where idempotency_key = p_idempotency_key;

  return v_balance;
end;
$$;

create function add_credits(
  p_user_id text,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  insert into credit_ledger (user_id, delta, balance_after, reason, idempotency_key)
  values (p_user_id, p_amount, 0, p_reason, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  if not found then
    select credits into v_balance from profiles where id = p_user_id;
    return v_balance;
  end if;

  update profiles
     set credits = credits + p_amount,
         updated_at = now()
   where id = p_user_id
  returning credits into v_balance;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update credit_ledger
     set balance_after = v_balance
   where idempotency_key = p_idempotency_key;

  return v_balance;
end;
$$;

-- Free plan: one month of data retention (see .claude/rules/pricing.md).
-- Called daily by the API's retention job (apps/api/src/jobs/retention.ts).
create function purge_expired_free_projects()
returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from flyer_projects p
   using profiles pr
   where pr.id = p.user_id
     and pr.plan = 'free'
     and p.updated_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
