-- JK MatchPredict: accounts and picks.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again (everything is "if not exists").
--
-- Security model: the app server talks to these tables with the service-role key. Row Level
-- Security is enabled with NO policies, so the public (anon) key and signed-in browsers can
-- not read or write them directly.

create table if not exists public.profiles (
  id            uuid primary key,            -- Supabase Auth user id
  email         text,
  display_name  text,
  avatar_url    text,
  provider      text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- Server-side sessions for the app's own sign-in cookie (only a hash of the token is stored).
create table if not exists public.sessions (
  token_hash   text primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked      boolean not null default false
);
create index if not exists sessions_user_idx on public.sessions (user_id);

-- One row per virtual pick; one pick per match per person.
create table if not exists public.picks (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  pick_id    text not null,
  canonical  text not null,                   -- stable key of the match
  outcome    smallint not null check (outcome in (0, 1, 2)),  -- 0 home, 1 draw, 2 away
  created_at timestamptz not null,
  forecast   jsonb not null,                  -- the forecast as it was when the pick was made
  result     text check (result in ('correct', 'incorrect', 'void')),
  score      text,
  settled_at timestamptz,
  primary key (user_id, canonical)
);
create index if not exists picks_user_created_idx on public.picks (user_id, created_at desc);

-- Over/Under picks (added later). market 'result' keeps outcome = 0 home / 1 draw / 2 away;
-- market 'totals' uses outcome 0 = over `line` goals, 1 = under. One pick per match per market
-- (the canonical key includes the market), so the primary key stays as it is.
alter table public.picks add column if not exists market text not null default 'result';
alter table public.picks add column if not exists line   numeric;

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.picks    enable row level security;

-- Public share links (one per person). Shown at /s/<id>; only a snapshot of statistics and the
-- last settled picks is stored, never the email, and the link can be disabled at any time.
create table if not exists public.shares (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  id           text not null unique,          -- random public identifier used in the URL
  enabled      boolean not null default true,
  show_name    boolean not null default false,
  display_name text,                          -- stored only when show_name is true
  snapshot     jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.shares enable row level security;
