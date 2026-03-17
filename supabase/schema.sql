create extension if not exists "pgcrypto";

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  domain text not null check (domain in ('personal', 'work', 'school')),
  status text not null check (status in ('backlog', 'today', 'in_progress', 'done')),
  priority text not null check (priority in ('low', 'medium', 'high')),
  due_date date,
  google_calendar_event_id text,
  google_calendar_event_url text,
  google_calendar_last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tasks add column if not exists google_calendar_event_id text;
alter table public.tasks add column if not exists google_calendar_event_url text;
alter table public.tasks add column if not exists google_calendar_last_synced_at timestamptz;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  calendar_id text not null default 'primary',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  url text not null,
  domain text not null default 'personal' check (domain in ('personal', 'work', 'school')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, url)
);

alter table public.calendar_feeds add column if not exists domain text;
update public.calendar_feeds set domain = 'personal' where domain is null;
alter table public.calendar_feeds alter column domain set default 'personal';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists google_calendar_connections_set_updated_at on public.google_calendar_connections;
create trigger google_calendar_connections_set_updated_at
before update on public.google_calendar_connections
for each row
execute function public.set_updated_at();

drop trigger if exists calendar_feeds_set_updated_at on public.calendar_feeds;
create trigger calendar_feeds_set_updated_at
before update on public.calendar_feeds
for each row
execute function public.set_updated_at();

alter table public.tasks enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.calendar_feeds enable row level security;

drop policy if exists "Users can read their own tasks" on public.tasks;
create policy "Users can read their own tasks"
on public.tasks
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own tasks" on public.tasks;
create policy "Users can insert their own tasks"
on public.tasks
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own tasks" on public.tasks;
create policy "Users can update their own tasks"
on public.tasks
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can delete their own tasks"
on public.tasks
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own calendar connection" on public.google_calendar_connections;
create policy "Users can read their own calendar connection"
on public.google_calendar_connections
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own calendar connection" on public.google_calendar_connections;
create policy "Users can insert their own calendar connection"
on public.google_calendar_connections
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own calendar connection" on public.google_calendar_connections;
create policy "Users can update their own calendar connection"
on public.google_calendar_connections
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own calendar connection" on public.google_calendar_connections;
create policy "Users can delete their own calendar connection"
on public.google_calendar_connections
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own calendar feeds" on public.calendar_feeds;
create policy "Users can read their own calendar feeds"
on public.calendar_feeds
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own calendar feeds" on public.calendar_feeds;
create policy "Users can insert their own calendar feeds"
on public.calendar_feeds
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own calendar feeds" on public.calendar_feeds;
create policy "Users can update their own calendar feeds"
on public.calendar_feeds
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own calendar feeds" on public.calendar_feeds;
create policy "Users can delete their own calendar feeds"
on public.calendar_feeds
for delete
using (auth.uid() = user_id);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_domain_idx on public.tasks (domain);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists calendar_feeds_user_id_idx on public.calendar_feeds (user_id);
