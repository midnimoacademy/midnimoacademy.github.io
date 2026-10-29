-- Applied to the connected academy project; records are learner-owned practice.
create table public.blockchain_lab_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 lesson_number integer not null check(lesson_number between 1 and 5),
 score integer not null check(score between 0 and 3),
 exercise_passed boolean not null,
 created_at timestamptz not null default now(),
 project_note text check(project_note is null or length(project_note)<=5000)
);
alter table public.blockchain_lab_attempts enable row level security;
revoke all on public.blockchain_lab_attempts from anon,authenticated;
grant select,insert on public.blockchain_lab_attempts to authenticated;
grant all on public.blockchain_lab_attempts to service_role;
create policy "Learners read own lab attempts" on public.blockchain_lab_attempts for select to authenticated using(user_id=(select auth.uid()));
create policy "Learners save own lab attempts" on public.blockchain_lab_attempts for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.blockchain_learner_profiles p where p.user_id=(select auth.uid())));
create index blockchain_lab_attempts_user_created on public.blockchain_lab_attempts(user_id,created_at desc);
