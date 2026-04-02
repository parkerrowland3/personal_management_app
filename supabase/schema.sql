create extension if not exists "pgcrypto";

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  domain text not null check (domain in ('personal', 'work', 'school')),
  status text not null check (status in ('inbox', 'backlog', 'today', 'in_progress', 'waiting', 'done')),
  priority text not null check (priority in ('low', 'medium', 'high')),
  due_date date,
  planned_date date,
  follow_up_date date,
  google_calendar_event_id text,
  google_calendar_event_url text,
  google_calendar_last_synced_at timestamptz,
  completion_kind text check (completion_kind in ('completed', 'skipped')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tasks add column if not exists google_calendar_event_id text;
alter table public.tasks add column if not exists google_calendar_event_url text;
alter table public.tasks add column if not exists google_calendar_last_synced_at timestamptz;
alter table public.tasks add column if not exists planned_date date;
alter table public.tasks add column if not exists follow_up_date date;
alter table public.tasks add column if not exists completion_kind text;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('inbox', 'backlog', 'today', 'in_progress', 'waiting', 'done'));
alter table public.tasks drop constraint if exists tasks_completion_kind_check;
alter table public.tasks add constraint tasks_completion_kind_check check (completion_kind in ('completed', 'skipped'));
update public.tasks
set completion_kind = 'completed'
where status = 'done' and completion_kind is null;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  calendar_id text not null default 'primary',
  default_domain text not null default 'personal' check (default_domain in ('personal', 'work', 'school')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.google_calendar_connections add column if not exists default_domain text;
update public.google_calendar_connections set default_domain = 'personal' where default_domain is null;
alter table public.google_calendar_connections alter column default_domain set default 'personal';

create table if not exists public.google_chat_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  chat_user_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.google_chat_connections add column if not exists google_email text;
alter table public.google_chat_connections add column if not exists chat_user_name text;
alter table public.google_chat_connections add column if not exists access_token text;
alter table public.google_chat_connections add column if not exists refresh_token text;
alter table public.google_chat_connections add column if not exists expires_at timestamptz;

create table if not exists public.google_chat_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('space', 'sender')),
  target_name text not null check (char_length(trim(target_name)) > 0),
  label text not null check (char_length(trim(label)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, target_type, target_name)
);

alter table public.google_chat_aliases add column if not exists target_type text;
alter table public.google_chat_aliases add column if not exists target_name text;
alter table public.google_chat_aliases add column if not exists label text;

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

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, name)
);

create table if not exists public.recurring_task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  domain text not null default 'personal' check (domain in ('personal', 'work', 'school')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  area_id uuid references public.areas(id) on delete set null,
  anchor_date date not null,
  interval_unit text not null check (interval_unit in ('day', 'week', 'month')),
  interval_count integer not null default 1 check (interval_count > 0),
  due_offset_days integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  label text not null check (char_length(trim(label)) > 0),
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_type text not null check (review_type in ('daily', 'weekly')),
  review_date date not null,
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, review_type, review_date)
);

alter table public.tasks add column if not exists area_id uuid references public.areas(id) on delete set null;
alter table public.tasks add column if not exists recurring_template_id uuid references public.recurring_task_templates(id) on delete set null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.advance_recurring_date(
  base_date date,
  interval_unit text,
  interval_count integer
)
returns date
language plpgsql
immutable
as $$
begin
  if interval_unit = 'day' then
    return base_date + interval_count;
  end if;

  if interval_unit = 'week' then
    return base_date + (interval_count * 7);
  end if;

  return (base_date + make_interval(months => interval_count))::date;
end;
$$;

create or replace function public.complete_task_occurrence(
  p_user_id uuid,
  p_task_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_task public.tasks%rowtype;
  updated_task public.tasks%rowtype;
  recurring_template public.recurring_task_templates%rowtype;
  next_task public.tasks%rowtype;
  source_date date;
  next_planned_date date;
  next_due_date date;
begin
  if p_action not in ('complete', 'skip') then
    raise exception 'Unsupported completion action.';
  end if;

  select *
  into existing_task
  from public.tasks
  where id = p_task_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Task not found.';
  end if;

  if existing_task.status = 'done' then
    return jsonb_build_object('task', to_jsonb(existing_task), 'nextTask', null);
  end if;

  update public.tasks
  set
    status = 'done',
    completed_at = timezone('utc', now()),
    completion_kind = case when p_action = 'skip' then 'skipped' else 'completed' end
  where id = existing_task.id
  returning *
  into updated_task;

  if updated_task.recurring_template_id is not null then
    select *
    into recurring_template
    from public.recurring_task_templates
    where id = updated_task.recurring_template_id
      and user_id = p_user_id
      and is_active = true;

    if found then
      perform 1
      from public.tasks
      where user_id = p_user_id
        and recurring_template_id = recurring_template.id
        and status <> 'done';

      if not found then
        source_date := coalesce(
          updated_task.planned_date,
          updated_task.due_date,
          recurring_template.anchor_date
        );
        next_planned_date := public.advance_recurring_date(
          source_date,
          recurring_template.interval_unit,
          recurring_template.interval_count
        );
        next_due_date := next_planned_date + recurring_template.due_offset_days;

        insert into public.tasks (
          user_id,
          title,
          description,
          domain,
          status,
          priority,
          planned_date,
          due_date,
          area_id,
          recurring_template_id
        )
        values (
          p_user_id,
          recurring_template.title,
          recurring_template.description,
          recurring_template.domain,
          'backlog',
          recurring_template.priority,
          next_planned_date,
          next_due_date,
          recurring_template.area_id,
          recurring_template.id
        )
        returning *
        into next_task;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'task',
    to_jsonb(updated_task),
    'nextTask',
    case when next_task.id is null then null else to_jsonb(next_task) end
  );
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

drop trigger if exists google_chat_connections_set_updated_at on public.google_chat_connections;
create trigger google_chat_connections_set_updated_at
before update on public.google_chat_connections
for each row
execute function public.set_updated_at();

drop trigger if exists google_chat_aliases_set_updated_at on public.google_chat_aliases;
create trigger google_chat_aliases_set_updated_at
before update on public.google_chat_aliases
for each row
execute function public.set_updated_at();

drop trigger if exists calendar_feeds_set_updated_at on public.calendar_feeds;
create trigger calendar_feeds_set_updated_at
before update on public.calendar_feeds
for each row
execute function public.set_updated_at();

drop trigger if exists areas_set_updated_at on public.areas;
create trigger areas_set_updated_at
before update on public.areas
for each row
execute function public.set_updated_at();

drop trigger if exists recurring_task_templates_set_updated_at on public.recurring_task_templates;
create trigger recurring_task_templates_set_updated_at
before update on public.recurring_task_templates
for each row
execute function public.set_updated_at();

drop trigger if exists task_checklist_items_set_updated_at on public.task_checklist_items;
create trigger task_checklist_items_set_updated_at
before update on public.task_checklist_items
for each row
execute function public.set_updated_at();

drop trigger if exists review_sessions_set_updated_at on public.review_sessions;
create trigger review_sessions_set_updated_at
before update on public.review_sessions
for each row
execute function public.set_updated_at();

alter table public.tasks enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.google_chat_connections enable row level security;
alter table public.google_chat_aliases enable row level security;
alter table public.calendar_feeds enable row level security;
alter table public.areas enable row level security;
alter table public.recurring_task_templates enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.review_sessions enable row level security;

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

drop policy if exists "Users can read their own chat connection" on public.google_chat_connections;
create policy "Users can read their own chat connection"
on public.google_chat_connections
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own chat connection" on public.google_chat_connections;
create policy "Users can insert their own chat connection"
on public.google_chat_connections
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chat connection" on public.google_chat_connections;
create policy "Users can update their own chat connection"
on public.google_chat_connections
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chat connection" on public.google_chat_connections;
create policy "Users can delete their own chat connection"
on public.google_chat_connections
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own chat aliases" on public.google_chat_aliases;
create policy "Users can read their own chat aliases"
on public.google_chat_aliases
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own chat aliases" on public.google_chat_aliases;
create policy "Users can insert their own chat aliases"
on public.google_chat_aliases
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chat aliases" on public.google_chat_aliases;
create policy "Users can update their own chat aliases"
on public.google_chat_aliases
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chat aliases" on public.google_chat_aliases;
create policy "Users can delete their own chat aliases"
on public.google_chat_aliases
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

drop policy if exists "Users can read their own areas" on public.areas;
create policy "Users can read their own areas"
on public.areas
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own areas" on public.areas;
create policy "Users can insert their own areas"
on public.areas
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own areas" on public.areas;
create policy "Users can update their own areas"
on public.areas
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own areas" on public.areas;
create policy "Users can delete their own areas"
on public.areas
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own recurring templates" on public.recurring_task_templates;
create policy "Users can read their own recurring templates"
on public.recurring_task_templates
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own recurring templates" on public.recurring_task_templates;
create policy "Users can insert their own recurring templates"
on public.recurring_task_templates
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own recurring templates" on public.recurring_task_templates;
create policy "Users can update their own recurring templates"
on public.recurring_task_templates
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own recurring templates" on public.recurring_task_templates;
create policy "Users can delete their own recurring templates"
on public.recurring_task_templates
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own checklist items" on public.task_checklist_items;
create policy "Users can read their own checklist items"
on public.task_checklist_items
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own checklist items" on public.task_checklist_items;
create policy "Users can insert their own checklist items"
on public.task_checklist_items
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own checklist items" on public.task_checklist_items;
create policy "Users can update their own checklist items"
on public.task_checklist_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own checklist items" on public.task_checklist_items;
create policy "Users can delete their own checklist items"
on public.task_checklist_items
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own review sessions" on public.review_sessions;
create policy "Users can read their own review sessions"
on public.review_sessions
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own review sessions" on public.review_sessions;
create policy "Users can insert their own review sessions"
on public.review_sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own review sessions" on public.review_sessions;
create policy "Users can update their own review sessions"
on public.review_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own review sessions" on public.review_sessions;
create policy "Users can delete their own review sessions"
on public.review_sessions
for delete
using (auth.uid() = user_id);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_domain_idx on public.tasks (domain);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_planned_date_idx on public.tasks (planned_date);
create index if not exists tasks_follow_up_date_idx on public.tasks (follow_up_date);
create index if not exists tasks_area_id_idx on public.tasks (area_id);
create index if not exists tasks_recurring_template_id_idx on public.tasks (recurring_template_id);
create index if not exists calendar_feeds_user_id_idx on public.calendar_feeds (user_id);
create index if not exists google_chat_connections_user_id_idx on public.google_chat_connections (user_id);
create index if not exists google_chat_aliases_user_id_idx on public.google_chat_aliases (user_id);
create index if not exists google_chat_aliases_target_lookup_idx on public.google_chat_aliases (user_id, target_type, target_name);
create index if not exists areas_user_id_idx on public.areas (user_id);
create index if not exists recurring_task_templates_user_id_idx on public.recurring_task_templates (user_id);
create index if not exists recurring_task_templates_area_id_idx on public.recurring_task_templates (area_id);
create index if not exists task_checklist_items_user_id_idx on public.task_checklist_items (user_id);
create index if not exists task_checklist_items_task_id_idx on public.task_checklist_items (task_id);
create index if not exists review_sessions_user_id_idx on public.review_sessions (user_id);
create index if not exists review_sessions_lookup_idx on public.review_sessions (user_id, review_type, review_date);

create table if not exists public.web_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) > 0),
  url text not null check (char_length(trim(url)) > 0),
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists web_bookmarks_set_updated_at on public.web_bookmarks;
create trigger web_bookmarks_set_updated_at
before update on public.web_bookmarks
for each row
execute function public.set_updated_at();

alter table public.web_bookmarks enable row level security;

drop policy if exists "Users can read their own bookmarks" on public.web_bookmarks;
create policy "Users can read their own bookmarks"
on public.web_bookmarks
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own bookmarks" on public.web_bookmarks;
create policy "Users can insert their own bookmarks"
on public.web_bookmarks
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own bookmarks" on public.web_bookmarks;
create policy "Users can update their own bookmarks"
on public.web_bookmarks
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own bookmarks" on public.web_bookmarks;
create policy "Users can delete their own bookmarks"
on public.web_bookmarks
for delete
using (auth.uid() = user_id);

create index if not exists web_bookmarks_user_id_idx on public.web_bookmarks (user_id);
