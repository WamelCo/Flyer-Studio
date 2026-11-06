-- ─────────────────────────────────────────────────────────────────────────────
-- AI Flyer Generator — core schema
--   * profiles are created by trigger with 0 credits
--   * credits change ONLY through deduct_credits / add_credits (service role)
--   * every credit movement is an idempotent ledger row
-- ─────────────────────────────────────────────────────────────────────────────

create type public.plan_tier as enum ('free', 'pro', 'max');
create type public.billing_interval as enum ('month', 'year');

-- ── Profiles ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  plan public.plan_tier not null default 'free',
  credits integer not null default 0 constraint credits_non_negative check (credits >= 0),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  billing_interval public.billing_interval,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
-- No insert/update/delete policies: rows come from the signup trigger and change
-- only through service-role code and the credit RPCs below.

-- ── Credit ledger ────────────────────────────────────────────────────────────
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;

create policy "Users read their own ledger"
  on public.credit_ledger for select to authenticated
  using ((select auth.uid()) = user_id);

-- ── Projects ─────────────────────────────────────────────────────────────────
create table public.flyer_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Untitled flyer' check (char_length(title) between 1 and 120),
  format text not null check (format in ('poster', 'square', 'story', 'landscape')),
  canvas jsonb not null,
  thumbnail_url text,
  generation_id uuid,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index flyer_projects_user_updated_idx on public.flyer_projects (user_id, updated_at desc);

alter table public.flyer_projects enable row level security;

create policy "Users read their own projects"
  on public.flyer_projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users create their own projects"
  on public.flyer_projects for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update their own projects"
  on public.flyer_projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users delete their own projects"
  on public.flyer_projects for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ── Generation jobs + failure log ────────────────────────────────────────────
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 500),
  intent text not null check (intent in ('event', 'sale', 'real_estate', 'party')),
  format text not null check (format in ('poster', 'square', 'story', 'landscape')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  variations jsonb not null default '[]'::jsonb,
  project_id uuid references public.flyer_projects (id) on delete set null,
  credits_spent integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index generation_jobs_user_created_idx on public.generation_jobs (user_id, created_at desc);

alter table public.generation_jobs enable row level security;

create policy "Users read their own generation jobs"
  on public.generation_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

alter table public.flyer_projects
  add constraint flyer_projects_generation_fk
  foreign key (generation_id) references public.generation_jobs (id) on delete set null;

create table public.ai_generation_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  job_id uuid references public.generation_jobs (id) on delete set null,
  prompt text,
  error_code text not null,
  message text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_generation_logs enable row level security; -- service role only

-- ── Exports ──────────────────────────────────────────────────────────────────
create table public.exports (
  id uuid primary key, -- client-generated so retries are idempotent
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.flyer_projects (id) on delete cascade,
  format text not null check (format in ('png', 'pdf', 'png-2k', 'png-4k')),
  credits_spent integer not null check (credits_spent >= 0),
  watermarked boolean not null,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index exports_user_created_idx on public.exports (user_id, created_at desc);

alter table public.exports enable row level security;

create policy "Users read their own exports"
  on public.exports for select to authenticated
  using ((select auth.uid()) = user_id);

-- ── Stripe webhook audit (service role only) ─────────────────────────────────
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- ── Triggers ─────────────────────────────────────────────────────────────────
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger flyer_projects_touch_updated_at
  before update on public.flyer_projects
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a Free profile with 0 credits.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Credit RPCs ──────────────────────────────────────────────────────────────
-- Both functions are idempotent on p_idempotency_key: the ledger row is claimed
-- first, so a replay (or a concurrent duplicate, which blocks on the unique index
-- until the first transaction ends) returns the current balance without moving it.

create function public.deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
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

  -- The row lock serialises concurrent deductions; the guard re-checks the balance
  -- after the lock is acquired, so parallel requests can never overdraw.
  update public.profiles
     set credits = credits - p_amount
   where id = p_user_id
     and credits >= p_amount
  returning credits into v_balance;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.credit_ledger
     set balance_after = v_balance
   where idempotency_key = p_idempotency_key;

  return v_balance;
end;
$$;

create function public.add_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
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

  update public.profiles
     set credits = credits + p_amount
   where id = p_user_id
  returning credits into v_balance;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.credit_ledger
     set balance_after = v_balance
   where idempotency_key = p_idempotency_key;

  return v_balance;
end;
$$;

-- Server-only: the browser can never call these, even for its own account.
revoke all on function public.deduct_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid, integer, text, text) to service_role;
grant execute on function public.add_credits(uuid, integer, text, text) to service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
