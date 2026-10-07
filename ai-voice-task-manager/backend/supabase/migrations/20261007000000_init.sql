-- AI Voice Task Manager – initial schema.
-- Source of truth for the app. Every table is owned by a user and protected by RLS.
create extension if not exists "pgcrypto";
create extension if not exists "vector";
create extension if not exists "pg_trgm";

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- structure ----------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  color_hex text,
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_area_id uuid references public.areas(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  organisation_id uuid references public.organisations(id) on delete set null,
  role text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.status_columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('inbox','todo','in_progress','waiting','done','custom')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- voice ----------
create table public.voice_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  audio_path text,                 -- Storage object path (bucket "audio"), null when deleted
  duration_sec double precision,
  language text,
  original_transcript text,
  clean_transcript text,
  processing_status text not null default 'waiting_for_processing'
    check (processing_status in ('waiting_for_processing','transcribed','parsed','committed','failed','discarded')),
  ai_summary text,
  extraction jsonb                 -- last ParseResponse (proposal)
);

-- ---------- tasks ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task','reminder','event','waiting','note')),
  title text not null,
  description text,
  status_id uuid references public.status_columns(id) on delete set null,
  priority smallint not null default 3 check (priority between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  start_at timestamptz,
  due_at timestamptz,
  event_end_at timestamptz,
  completed_at timestamptz,
  reminder_at timestamptz,
  follow_up_at timestamptz,
  recurrence_rule text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  area_id uuid references public.areas(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  source_id uuid references public.voice_entries(id) on delete set null,
  original_transcript text,
  clean_transcript text,
  ai_confidence real,
  estimated_duration_min int,
  is_waiting boolean not null default false,
  waiting_for_person_id uuid references public.people(id) on delete set null,
  waiting_subject text,
  person_id uuid references public.people(id) on delete set null,
  organisation_id uuid references public.organisations(id) on delete set null,
  tags text[] not null default '{}',
  calendar_event_id text,
  apple_reminder_id text,
  embedding vector(768),
  embedding_updated_at timestamptz,
  deleted_at timestamptz
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  fire_at timestamptz not null,
  repeat_rule text,
  kind text not null default 'reminder' check (kind in ('reminder','follow_up','before_due','overdue')),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  linked_type text not null check (linked_type in ('task','person','organisation','project','calendar_event','voice_entry','document','email')),
  linked_id text not null,
  created_at timestamptz not null default now()
);

-- ---------- AI memory ----------
create table public.preference_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Almaty',
  language text not null default 'ru',
  morning_time text not null default '09:00',
  day_time text not null default '14:00',
  evening_time text not null default '19:00',
  night_time text not null default '22:00',
  end_of_day_time text not null default '18:00',
  default_priority smallint not null default 3,
  auto_file_threshold numeric(3,2) not null default 0.85,
  aliases jsonb not null default '{}'::jsonb,
  routing_rules jsonb not null default '{}'::jsonb,
  delete_audio_after_transcription boolean not null default true,
  private_mode boolean not null default false,
  apple_reminders_sync text not null default 'off' check (apple_reminders_sync in ('off','important','with_reminder','all')),
  briefing_time text not null default '08:00',
  updated_at timestamptz not null default now()
);

-- Every time the user moves a task to another project/area we record it; the parser learns from ≥3 repeats.
create table public.classification_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  pattern text not null,                -- normalised title / key phrase
  from_project_id uuid,
  from_area_id uuid,
  to_project_id uuid not null,
  to_area_id uuid,
  created_at timestamptz not null default now()
);

create table public.action_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  undo_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index on public.tasks (user_id, due_at) where deleted_at is null;
create index on public.tasks (user_id, status_id) where deleted_at is null;
create index on public.tasks (user_id, project_id, area_id) where deleted_at is null;
create index on public.tasks (user_id, updated_at);
create index on public.tasks using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(clean_transcript,'')));
create index on public.tasks using gin (title gin_trgm_ops);
create index on public.tasks using hnsw (embedding vector_cosine_ops);
create index on public.reminders (user_id, fire_at) where delivered_at is null;
create index on public.voice_entries (user_id, processing_status);
create index on public.classification_corrections (user_id, pattern);
create index on public.projects (user_id, updated_at);
create index on public.areas (user_id, updated_at);
create index on public.people (user_id, updated_at);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['workspaces','projects','areas','organisations','people','status_columns','voice_entries','tasks','reminders','preference_profiles']
  loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['workspaces','projects','areas','organisations','people','status_columns','voice_entries','tasks','reminders','task_links','preference_profiles','classification_corrections','action_batches','chat_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_owner on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- ---------- defaults for a new user ----------
create or replace function public.seed_user_defaults() returns trigger language plpgsql security definer set search_path = public as $$
declare w_work uuid; w_personal uuid;
begin
  insert into public.preference_profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.workspaces (user_id, name, sort_order) values (new.id, 'Работа', 0) returning id into w_work;
  insert into public.workspaces (user_id, name, sort_order) values (new.id, 'Личное', 1) returning id into w_personal;
  insert into public.status_columns (user_id, name, kind, sort_order) values
    (new.id, 'Inbox', 'inbox', 0),
    (new.id, 'To Do', 'todo', 1),
    (new.id, 'В работе', 'in_progress', 2),
    (new.id, 'Жду ответ', 'waiting', 3),
    (new.id, 'Завершено', 'done', 4);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.seed_user_defaults();

-- ---------- RPC: semantic search ----------
create or replace function public.match_tasks(p_user_id uuid, query_embedding vector(768), match_count int default 20, min_similarity float default 0.3)
returns table (id uuid, similarity float) language sql stable security invoker as $$
  select t.id, 1 - (t.embedding <=> query_embedding) as similarity
  from public.tasks t
  where t.user_id = p_user_id and t.user_id = auth.uid() and t.deleted_at is null and t.embedding is not null
    and 1 - (t.embedding <=> query_embedding) >= min_similarity
  order by t.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------- RPC: learned routing hints (pattern → where the user moved it, counted) ----------
create or replace function public.routing_hints(p_user_id uuid)
returns table (pattern text, project_id uuid, area_id uuid, count bigint) language sql stable security invoker as $$
  select c.pattern, c.to_project_id as project_id, c.to_area_id as area_id, count(*) as count
  from public.classification_corrections c
  where c.user_id = p_user_id and c.user_id = auth.uid()
  group by c.pattern, c.to_project_id, c.to_area_id
  having count(*) >= 2
  order by count(*) desc
  limit 100;
$$;

-- ---------- RPC: record a correction when a task is moved (called by the app) ----------
create or replace function public.record_correction(p_task_id uuid, p_to_project_id uuid, p_to_area_id uuid)
returns void language plpgsql security invoker as $$
declare t record; pat text;
begin
  select * into t from public.tasks where id = p_task_id and user_id = auth.uid();
  if not found then return; end if;
  if t.project_id is not distinct from p_to_project_id and t.area_id is not distinct from p_to_area_id then return; end if;
  -- key phrase: first 4 significant words of the title, lowercased
  pat := lower(regexp_replace(t.title, '[^[:alnum:][:space:]]', ' ', 'g'));
  pat := array_to_string((regexp_split_to_array(trim(pat), '\s+'))[1:4], ' ');
  insert into public.classification_corrections (user_id, task_id, pattern, from_project_id, from_area_id, to_project_id, to_area_id)
  values (auth.uid(), p_task_id, pat, t.project_id, t.area_id, p_to_project_id, p_to_area_id);
  update public.tasks set project_id = p_to_project_id, area_id = p_to_area_id,
    workspace_id = coalesce((select workspace_id from public.projects where id = p_to_project_id), workspace_id)
  where id = p_task_id;
end $$;

-- ---------- RPC: account deletion / export ----------
create or replace function public.export_my_data() returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'workspaces', (select coalesce(jsonb_agg(w), '[]') from public.workspaces w where w.user_id = auth.uid()),
    'projects', (select coalesce(jsonb_agg(p), '[]') from public.projects p where p.user_id = auth.uid()),
    'areas', (select coalesce(jsonb_agg(a), '[]') from public.areas a where a.user_id = auth.uid()),
    'people', (select coalesce(jsonb_agg(p), '[]') from public.people p where p.user_id = auth.uid()),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) - 'embedding'), '[]') from public.tasks t where t.user_id = auth.uid()),
    'voice_entries', (select coalesce(jsonb_agg(v), '[]') from public.voice_entries v where v.user_id = auth.uid()),
    'preferences', (select to_jsonb(pp) from public.preference_profiles pp where pp.user_id = auth.uid())
  );
$$;

create or replace function public.delete_my_chat_history() returns void language sql security invoker as $$
  delete from public.chat_messages where user_id = auth.uid();
$$;

create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Storage bucket for optional audio ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800, array['audio/mp4','audio/m4a','audio/x-m4a','audio/aac','audio/wav','audio/mpeg'])
on conflict (id) do nothing;

create policy "audio owner read" on storage.objects for select to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio owner write" on storage.objects for insert to authenticated with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio owner delete" on storage.objects for delete to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
