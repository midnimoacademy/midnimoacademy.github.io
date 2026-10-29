create table public.welcome_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete cascade,
 email text not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','failed','unknown','skipped')),
 message_id text,error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index welcome_email_unique_address on public.welcome_email_deliveries(lower(email));
alter table public.welcome_email_deliveries enable row level security;
revoke all on public.welcome_email_deliveries from anon,authenticated;
grant select on public.welcome_email_deliveries to authenticated;
grant all on public.welcome_email_deliveries to service_role;
create policy "Administrators read welcome email records" on public.welcome_email_deliveries for select to authenticated using(exists(select 1 from public.academy_admins where user_id=(select auth.uid())));
insert into public.welcome_email_deliveries(user_id,email)
select distinct on(lower(email)) id,lower(email) from auth.users where email is not null and email<>'' and deleted_at is null and not is_anonymous order by lower(email),created_at on conflict do nothing;