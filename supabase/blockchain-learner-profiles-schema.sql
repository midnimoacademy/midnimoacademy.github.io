create table public.blockchain_learner_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check(length(trim(full_name)) between 2 and 120),
 gender text not null check(gender in ('Female','Male','Non-binary','Self-described','Prefer not to say')),
 gender_description text check(gender_description is null or length(trim(gender_description)) between 1 and 100),
 age integer not null check(age between 1 and 120),
 city text not null check(length(trim(city)) between 2 and 100),
 country text not null check(length(trim(country)) between 2 and 100),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(gender <> 'Self-described' or nullif(trim(gender_description),'') is not null)
);
alter table public.blockchain_learner_profiles enable row level security;
revoke all on public.blockchain_learner_profiles from anon,authenticated;
grant select,insert,update on public.blockchain_learner_profiles to authenticated;
grant all on public.blockchain_learner_profiles to service_role;
create policy "Learners read own Blockchain details" on public.blockchain_learner_profiles for select to authenticated using(user_id=(select auth.uid()));
create policy "Learners create own Blockchain details" on public.blockchain_learner_profiles for insert to authenticated with check(user_id=(select auth.uid()));
create policy "Learners update own Blockchain details" on public.blockchain_learner_profiles for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "Administrators read Blockchain learner details" on public.blockchain_learner_profiles for select to authenticated using(exists(select 1 from public.academy_admins where user_id=(select auth.uid())));
