-- Apply to the existing academy project before publishing the new pages.
-- Lesson content and answer keys are provisioned separately, outside public Git.
begin;
create schema blockchain_pathway;
revoke all on schema blockchain_pathway from public, anon, authenticated;

create table blockchain_pathway.lessons (
  id smallint primary key check (id between 1 and 20),
  title text not null,
  content jsonb not null,
  quiz_key jsonb not null,
  exercise_key text,
  is_project boolean generated always as (id in (10,20)) stored,
  check ((id in (10,20)) = (exercise_key is null))
);
create table blockchain_pathway.progress (
  learner uuid not null references auth.users(id) on delete cascade,
  lesson smallint not null references blockchain_pathway.lessons(id),
  sections text[] not null default '{}',
  practice_passed boolean not null default false,
  best_score smallint not null default 0,
  completed_at timestamptz,
  primary key (learner,lesson)
);
create table blockchain_pathway.attempts (
  id uuid primary key default gen_random_uuid(),
  learner uuid not null,
  lesson smallint not null,
  answers jsonb not null,
  score smallint not null check (score between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (learner,lesson) references blockchain_pathway.progress on delete cascade
);
create index pathway_attempts_learner_lesson on blockchain_pathway.attempts (learner,lesson,created_at desc);
create table blockchain_pathway.submissions (
  id uuid primary key default gen_random_uuid(),
  learner uuid not null,
  lesson smallint not null,
  evidence text not null,
  decision text not null check (decision in ('pending','passed','needs_revision')),
  grades jsonb,
  feedback text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key (learner,lesson) references blockchain_pathway.progress on delete cascade
);
create index pathway_submissions_learner_lesson on blockchain_pathway.submissions (learner,lesson,created_at desc);
create unique index pathway_one_pending_project on blockchain_pathway.submissions (learner,lesson) where decision='pending';
create table blockchain_pathway.overrides (
  learner uuid not null references auth.users(id) on delete cascade,
  lesson smallint not null references blockchain_pathway.lessons(id),
  primary key (learner,lesson)
);
create table blockchain_pathway.audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  learner uuid,
  lesson smallint not null,
  action text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create table blockchain_pathway.certificates (
  learner uuid not null references auth.users(id) on delete cascade,
  level text not null check (level in ('Intermediate','Advanced')),
  reference uuid unique not null default gen_random_uuid(),
  full_name text not null,
  completed_at timestamptz not null,
  primary key (learner,level)
);

alter table blockchain_pathway.lessons enable row level security;
alter table blockchain_pathway.progress enable row level security;
alter table blockchain_pathway.attempts enable row level security;
alter table blockchain_pathway.submissions enable row level security;
alter table blockchain_pathway.overrides enable row level security;
alter table blockchain_pathway.audit enable row level security;
alter table blockchain_pathway.certificates enable row level security;
revoke all on all tables in schema blockchain_pathway from public, anon, authenticated;
-- With no client table policies, all access is mediated by the scoped RPCs below.

create function blockchain_pathway.level_done(p_learner uuid, p_first integer)
returns boolean language sql stable set search_path='' as $$
  select count(*)=10 from blockchain_pathway.progress
  where learner=p_learner and lesson between p_first and p_first+9 and completed_at is not null;
$$;
create function blockchain_pathway.can_open(p_learner uuid, p_lesson integer)
returns boolean language sql stable set search_path='' as $$
  select p_lesson between 1 and 20
    and exists (select 1 from public.blockchain_learner_profiles where user_id=p_learner)
    and exists (select 1 from public.course_enrollments where user_id=p_learner and course_slug='blockchain-development')
    and (p_lesson <= 10 or blockchain_pathway.level_done(p_learner,1))
    and (
      exists (select 1 from blockchain_pathway.progress where learner=p_learner and lesson=p_lesson and completed_at is not null)
      or exists (select 1 from blockchain_pathway.overrides where learner=p_learner and lesson=p_lesson)
      or not exists (
        select 1 from generate_series(case when p_lesson<=10 then 1 else 11 end,p_lesson-1) prerequisite(id)
        where not exists (
          select 1 from blockchain_pathway.progress
          where learner=p_learner and lesson=prerequisite.id and completed_at is not null
        )
      )
    );
$$;
create function blockchain_pathway.finish(p_learner uuid, p_lesson integer)
returns void language plpgsql set search_path='' as $$
declare learner_name text;
begin
  update blockchain_pathway.progress
    set completed_at=now()
    where learner=p_learner and lesson=p_lesson and completed_at is null
      and best_score>=70 and practice_passed and sections @> array['theory','example','review'];
  if not found then return; end if;
  select full_name into learner_name from public.blockchain_learner_profiles where user_id=p_learner;
  insert into blockchain_pathway.certificates(learner,level,full_name,completed_at)
  select p_learner, levels.name,learner_name,now()
  from (values ('Intermediate',1),('Advanced',11)) as levels(name,first_lesson)
  where blockchain_pathway.level_done(p_learner,levels.first_lesson)
    and (levels.first_lesson=1 or blockchain_pathway.level_done(p_learner,1))
  on conflict (learner,level) do nothing;
end;
$$;

create function public.blockchain_pathway_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); enrolled boolean; result jsonb;
begin
  if uid is null or not exists(select 1 from public.blockchain_learner_profiles where user_id=uid) then
    raise exception 'Learner profile required' using errcode='42501';
  end if;
  select exists(select 1 from public.course_enrollments where user_id=uid and course_slug='blockchain-development') into enrolled;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'title',l.title,'project',l.is_project,
    'available',blockchain_pathway.can_open(uid,l.id),'completed_at',p.completed_at,
    'score',p.best_score,'sections',coalesce(p.sections,'{}'),'practice_passed',coalesce(p.practice_passed,false),
    'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
      select score,created_at from blockchain_pathway.attempts where learner=uid and lesson=l.id order by created_at desc limit 10
    ) a),'[]'),
    'submission',(select jsonb_build_object('decision',s.decision,'evidence',s.evidence,'feedback',s.feedback,'grades',s.grades,'created_at',s.created_at)
      from blockchain_pathway.submissions s where s.learner=uid and s.lesson=l.id order by s.created_at desc,s.id desc limit 1)
  ) order by l.id),'[]') into result
  from blockchain_pathway.lessons l left join blockchain_pathway.progress p on p.learner=uid and p.lesson=l.id;
  return jsonb_build_object('enrolled',enrolled,'lessons',result,'certificates',coalesce(
    (select jsonb_agg(to_jsonb(c)-'learner' order by c.completed_at,c.level desc)
     from blockchain_pathway.certificates c where c.learner=uid),'[]'));
end;
$$;

create function public.blockchain_pathway_lesson(p_lesson integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not blockchain_pathway.can_open(auth.uid(),p_lesson) then
    raise exception 'Lesson is locked' using errcode='42501';
  end if;
  select jsonb_build_object('title',title,'project',is_project,'content',content)
    into result from blockchain_pathway.lessons where id=p_lesson;
  return result;
end;
$$;

create function public.blockchain_pathway_record(p_action text,p_lesson integer default null,p_value jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); item blockchain_pathway.lessons; score integer;
        value_text text:=p_value#>>'{}'; status text;
begin
  if uid is null or not exists(select 1 from public.blockchain_learner_profiles where user_id=uid) then
    raise exception 'Learner profile required' using errcode='42501';
  end if;
  if p_action='enrol' then
    insert into public.course_enrollments(user_id,course_slug)
      values(uid,'blockchain-development') on conflict do nothing;
    return '{"enrolled":true}';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('blockchain-pathway:'||uid::text,0));
  if p_lesson is null or not blockchain_pathway.can_open(uid,p_lesson) then
    raise exception 'Lesson is locked' using errcode='42501';
  end if;
  select * into strict item from blockchain_pathway.lessons where id=p_lesson;
  insert into blockchain_pathway.progress(learner,lesson) values(uid,p_lesson) on conflict do nothing;
  case p_action
    when 'section' then
      if jsonb_typeof(p_value) is distinct from 'string' or value_text not in ('theory','example','review') then
        raise exception 'Invalid section' using errcode='22023';
      end if;
      update blockchain_pathway.progress set sections=array_append(sections,value_text)
        where learner=uid and lesson=p_lesson and not value_text=any(sections);
    when 'quiz' then
      if jsonb_typeof(p_value) is distinct from 'array' then raise exception 'Answers required' using errcode='22023'; end if;
      if jsonb_array_length(p_value)<>jsonb_array_length(item.quiz_key) or exists(
        select 1 from jsonb_array_elements(p_value) a where a not in ('0','1','2','3')
      ) then raise exception 'Answer every question' using errcode='22023'; end if;
      select (count(*) filter (where submitted.answer=expected.answer)*100/jsonb_array_length(item.quiz_key))::integer
        into score from jsonb_array_elements(p_value) with ordinality submitted(answer,n)
        join jsonb_array_elements(item.quiz_key) with ordinality expected(answer,n) using(n);
      insert into blockchain_pathway.attempts(learner,lesson,answers,score) values(uid,p_lesson,p_value,score);
      update blockchain_pathway.progress set best_score=greatest(best_score,score) where learner=uid and lesson=p_lesson;
    when 'practice' then
      if item.is_project or jsonb_typeof(p_value) is distinct from 'string' or length(value_text)>200 then
        raise exception 'Invalid exercise answer' using errcode='22023';
      end if;
      status:=case when lower(btrim(value_text))=item.exercise_key then 'passed' else 'needs_revision' end;
      insert into blockchain_pathway.submissions(learner,lesson,evidence,decision) values(uid,p_lesson,value_text,status);
      if status='passed' then
        update blockchain_pathway.progress set practice_passed=true where learner=uid and lesson=p_lesson;
      end if;
    when 'project' then
      if not item.is_project or jsonb_typeof(p_value) is distinct from 'string'
        or length(btrim(value_text)) not between 80 and 8000 then
        raise exception 'Provide 80 to 8000 characters of project evidence' using errcode='22023';
      end if;
      if exists(select 1 from blockchain_pathway.progress where learner=uid and lesson=p_lesson and practice_passed) then
        raise exception 'Project already approved' using errcode='22023';
      end if;
      insert into blockchain_pathway.submissions(learner,lesson,evidence,decision)
        values(uid,p_lesson,btrim(value_text),'pending');
      status:='pending';
    else raise exception 'Invalid action' using errcode='22023';
  end case;
  perform blockchain_pathway.finish(uid,p_lesson);
  return jsonb_strip_nulls(jsonb_build_object('score',score,'decision',status));
end;
$$;

create function public.blockchain_pathway_verify(p_reference uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('level',level,'completed_at',completed_at,'reference',reference)
    from blockchain_pathway.certificates where reference=p_reference;
$$;

create function public.blockchain_pathway_admin(p_action text,p_learner uuid default null,
  p_lesson integer default null,p_value jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; target blockchain_pathway.submissions; project_grades jsonb;
        note text; project_decision text; project_score integer; old_content jsonb; section_key text;
begin
  if uid is null or not exists (select 1 from public.academy_admins where user_id=uid) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  case p_action
    when 'roster' then
      select jsonb_build_object(
        'students',coalesce((
          select jsonb_agg(jsonb_build_object('id',e.user_id,'name',lp.full_name,
            'enrolled_at',e.enrolled_at,'completed',(select count(*) from blockchain_pathway.progress p where p.learner=e.user_id and p.completed_at is not null),
            'struggling',(select count(*) from (
              select lesson from blockchain_pathway.attempts a where a.learner=e.user_id
              group by lesson having count(*) filter(where a.score<70)>=2 and max(a.score)<70
            ) repeated)) order by e.enrolled_at desc)
          from public.course_enrollments e join public.blockchain_learner_profiles lp on lp.user_id=e.user_id
          where e.course_slug='blockchain-development'),'[]'),
        'pending',(select count(*) from blockchain_pathway.submissions where decision='pending'),
        'intermediate',(select count(*) from blockchain_pathway.certificates where level='Intermediate'),
        'advanced',(select count(*) from blockchain_pathway.certificates where level='Advanced'),
        'lessons',(select jsonb_agg(jsonb_build_object('id',id,'title',title) order by id) from blockchain_pathway.lessons)
      ) into result;
    when 'student' then
      select jsonb_build_object(
        'progress',coalesce((select jsonb_agg(to_jsonb(p)-'learner' order by p.lesson)
          from blockchain_pathway.progress p where p.learner=p_learner),'[]'),
        'attempts',coalesce((select jsonb_agg(to_jsonb(a)-'learner'-'answers' order by a.created_at desc)
          from (select * from blockchain_pathway.attempts where learner=p_learner order by created_at desc limit 100) a),'[]'),
        'submissions',coalesce((select jsonb_agg(to_jsonb(s)-'learner' order by (s.decision='pending') desc,s.created_at desc)
          from (select * from blockchain_pathway.submissions where learner=p_learner order by (decision='pending') desc,created_at desc limit 100) s),'[]'),
        'unlocks',coalesce((select jsonb_agg(to_jsonb(a)-'learner' order by a.id desc)
          from blockchain_pathway.audit a where a.learner=p_learner and a.action='unlock'),'[]')
      ) into result;
    when 'review' then
      project_grades:=p_value->'grades'; note:=btrim(p_value->>'feedback');
      if jsonb_typeof(project_grades) is distinct from 'array' or note is null or length(note) not between 10 and 3000 then
        raise exception 'Scores and feedback are required' using errcode='22023';
      end if;
      if jsonb_array_length(project_grades)<>4 or exists(
        select 1 from jsonb_array_elements(project_grades) x where jsonb_typeof(x)<>'number' or x::text !~ '^([0-9]|1[0-9]|2[0-5])$'
      ) then raise exception 'Enter four integer scores from 0 to 25' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('blockchain-pathway:'||p_learner::text,0));
      select * into target from blockchain_pathway.submissions where id=(p_value->>'id')::uuid
        and learner=p_learner and lesson=p_lesson and lesson in (10,20) and decision='pending' for update;
      if not found then raise exception 'Project is no longer pending' using errcode='22023'; end if;
      select sum(x::text::integer) into project_score from jsonb_array_elements(project_grades) x;
      project_decision:=case when project_score>=70 and not exists(select 1 from jsonb_array_elements(project_grades) x where x::text::integer<15)
        then 'passed' else 'needs_revision' end;
      update blockchain_pathway.submissions s set decision=project_decision,
        grades=project_grades,feedback=note,reviewed_at=now() where s.id=target.id;
      if project_decision='passed' then
        update blockchain_pathway.progress set practice_passed=true where learner=p_learner and lesson=p_lesson;
        perform blockchain_pathway.finish(p_learner,p_lesson);
      end if;
      result:=jsonb_build_object('decision',project_decision,'score',project_score);
      insert into blockchain_pathway.audit(actor,learner,lesson,action,detail)
        values(uid,p_learner,p_lesson,p_action,result||jsonb_build_object('submission',target.id,'feedback',note,'grades',project_grades));
    when 'unlock' then
      note:=btrim(p_value#>>'{}');
      if note is null or length(note) not between 10 and 1000 or p_lesson is null
        or not exists (select 1 from public.course_enrollments e join public.blockchain_learner_profiles lp on lp.user_id=e.user_id
          where e.user_id=p_learner and e.course_slug='blockchain-development')
        or (p_lesson>10 and not blockchain_pathway.level_done(p_learner,1)) then
        raise exception 'Enrolled learner, reason and level prerequisite required' using errcode='22023';
      end if;
      insert into blockchain_pathway.overrides(learner,lesson) values(p_learner,p_lesson) on conflict do nothing;
      if found then
        insert into blockchain_pathway.audit(actor,learner,lesson,action,detail)
          values(uid,p_learner,p_lesson,p_action,jsonb_build_object('reason',note));
      end if;
      result:='{"available":true}';
    when 'content' then
      select content into result from blockchain_pathway.lessons where id=p_lesson;
    when 'edit_reading' then
      section_key:=p_value->>'section';
      note:=btrim(p_value->>'body');
      if section_key is null or section_key not in ('theory','example','review')
        or note is null or length(note) not between 80 and 12000 then
        raise exception 'Valid section and 80 to 12000 characters required' using errcode='22023';
      end if;
      select content into strict old_content from blockchain_pathway.lessons where id=p_lesson for update;
      update blockchain_pathway.lessons set content=jsonb_set(content,array[section_key,'body'],to_jsonb(note)) where id=p_lesson;
      insert into blockchain_pathway.audit(actor,lesson,action,detail)
        values(uid,p_lesson,p_action,jsonb_build_object('section',section_key,'previous',old_content->section_key->>'body'));
      result:='{"saved":true}';
    else raise exception 'Invalid action' using errcode='22023';
  end case;
  return result;
end;
$$;

revoke execute on all functions in schema blockchain_pathway from public, anon, authenticated;
revoke execute on function public.blockchain_pathway_dashboard(), public.blockchain_pathway_lesson(integer),
  public.blockchain_pathway_record(text,integer,jsonb), public.blockchain_pathway_admin(text,uuid,integer,jsonb),
  public.blockchain_pathway_verify(uuid) from public, anon, authenticated;
grant execute on function public.blockchain_pathway_dashboard(), public.blockchain_pathway_lesson(integer),
  public.blockchain_pathway_record(text,integer,jsonb), public.blockchain_pathway_admin(text,uuid,integer,jsonb) to authenticated;
grant execute on function public.blockchain_pathway_verify(uuid) to anon, authenticated;
commit;
