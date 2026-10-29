create table public.newsletter_runs (
 id uuid primary key default gen_random_uuid(),
 run_key text not null unique,
 kind text not null check(kind in ('newsletter','progress')),
 subject text not null, body text not null,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.newsletter_deliveries (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.newsletter_runs(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','accepted','failed','unknown','skipped')),
 message_id text, error text, updated_at timestamptz not null default now(),
 unique(run_id,user_id)
);
create index newsletter_deliveries_run_status on public.newsletter_deliveries(run_id,status);
create table public.newsletter_unsubscribe_tokens (
 token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.newsletter_runs enable row level security;
alter table public.newsletter_deliveries enable row level security;
alter table public.newsletter_unsubscribe_tokens enable row level security;
revoke all on public.newsletter_runs,public.newsletter_deliveries,public.newsletter_unsubscribe_tokens from anon,authenticated;
grant select on public.newsletter_runs,public.newsletter_deliveries to authenticated;
grant all on public.newsletter_runs,public.newsletter_deliveries,public.newsletter_unsubscribe_tokens to service_role;
create policy "Administrators read newsletter runs" on public.newsletter_runs for select to authenticated using(exists(select 1 from public.academy_admins where user_id=(select auth.uid())));
create policy "Administrators read newsletter delivery records" on public.newsletter_deliveries for select to authenticated using(exists(select 1 from public.academy_admins where user_id=(select auth.uid())));
create policy "Service role manages unsubscribe tokens" on public.newsletter_unsubscribe_tokens to service_role using(true) with check(true);