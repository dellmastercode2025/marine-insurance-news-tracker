-- News feed (shared, read-only for users) and mailbox integration (per user).

-- ---------- news ----------
create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('marine','aviation','kazakhstan')),
  source text not null,
  title text not null,
  url text not null,
  summary text,
  language text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (topic, url)
);
create index on public.news_items (topic, published_at desc);

create table public.news_digests (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  digest_date date not null,
  content text not null,
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (topic, digest_date)
);

create table public.news_refresh_log (
  topic text primary key,
  refreshed_at timestamptz not null default now(),
  items_added int not null default 0,
  last_error text
);

alter table public.news_items enable row level security;
alter table public.news_digests enable row level security;
alter table public.news_refresh_log enable row level security;
create policy news_items_read on public.news_items for select to authenticated using (true);
create policy news_digests_read on public.news_digests for select to authenticated using (true);
create policy news_refresh_read on public.news_refresh_log for select to authenticated using (true);
-- writes only through the service role (edge functions)

-- ---------- mail ----------
create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','microsoft','imap')),
  email text not null,
  display_name text,
  status text not null default 'connected' check (status in ('connected','error','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  sync_days int not null default 14,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);

-- Encrypted tokens / passwords. RLS enabled with NO policies: only the service role (edge functions) can read.
create table public.mail_credentials (
  account_id uuid primary key references public.mail_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  external_id text not null,
  thread_id text not null,
  subject text,
  from_name text,
  from_email text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  snippet text,
  body_text text,
  received_at timestamptz not null,
  is_from_me boolean not null default false,
  is_read boolean,
  has_attachments boolean not null default false,
  web_link text,
  needs_reply boolean not null default false,
  reply_status text not null default 'none' check (reply_status in ('none','pending','replied','dismissed','task_created')),
  ai_reason text,
  ai_priority smallint,
  ai_suggested_action text,
  ai_checked_at timestamptz,
  linked_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index on public.mail_messages (user_id, received_at desc);
create index on public.mail_messages (user_id, needs_reply, reply_status) where needs_reply;
create index on public.mail_messages (account_id, thread_id, received_at);
create index on public.mail_messages using gin (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'')));

create trigger mail_accounts_updated_at before update on public.mail_accounts for each row execute function public.set_updated_at();
create trigger mail_messages_updated_at before update on public.mail_messages for each row execute function public.set_updated_at();

alter table public.mail_accounts enable row level security;
alter table public.mail_credentials enable row level security;
alter table public.mail_messages enable row level security;
create policy mail_accounts_owner on public.mail_accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mail_messages_owner on public.mail_messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- realtime for the web client ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.tasks, public.projects, public.areas, public.mail_messages, public.mail_accounts';
  end if;
exception when others then null;
end $$;

-- ---------- helper: unanswered mail summary for briefing/chat ----------
create or replace function public.unanswered_mail_count() returns int language sql stable security invoker as $$
  select count(*)::int from public.mail_messages where user_id = auth.uid() and needs_reply and reply_status = 'pending';
$$;
