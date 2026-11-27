-- The production migration also imported the 48 questions privately from the supplied exam.
-- Keep the answer key out of the public repository.
create schema if not exists exam_private;
revoke all on schema exam_private from public, anon, authenticated;

alter table public.academy_exams add column timed_exam boolean not null default false;
alter table public.exam_attempts
  add column telegram_username text,
  add column started_at timestamptz,
  add column expires_at timestamptz,
  add column finished_at timestamptz;

create index timed_exam_expiration on public.exam_attempts (expires_at)
where expires_at is not null and finished_at is null;

create policy timed_exam_rpc_insert on public.exam_attempts
as restrictive for insert to authenticated
with check (telegram_username is null and started_at is null and expires_at is null and finished_at is null
  and not exists (select 1 from public.academy_exams e where e.id = exam_id and e.timed_exam));

create policy timed_exam_rpc_update on public.exam_attempts
as restrictive for update to authenticated
using (expires_at is null)
with check (telegram_username is null and started_at is null and expires_at is null and finished_at is null
  and not exists (select 1 from public.academy_exams e where e.id = exam_id and e.timed_exam));

create policy timed_exam_result_visibility on public.exam_attempts
as restrictive for select to authenticated
using (expires_at is null or user_id = (select auth.uid()) or public.academy_is_admin());

-- The existing trigger continues to guard legacy attempts. Timed writes are
-- confined to server functions by the restrictive policies above.
do $migration$
declare definition text := pg_get_functiondef('public.exam_attempt_guard()'::regprocedure);
begin
  if strpos(definition, 'if tg_op=''UPDATE'' then') = 0 then
    raise exception 'Unexpected exam attempt guard definition';
  end if;
  execute replace(definition, 'if tg_op=''UPDATE'' then',
    'if tg_op=''UPDATE'' then
       if old.expires_at is not null then return new; end if;');
end;
$migration$;

create function exam_private.finish_attempt(attempt_id bigint)
returns public.exam_attempts language sql set search_path = '' as $$
  update public.exam_attempts a
  set finished_at = least(clock_timestamp(), a.expires_at),
      submitted_at = least(clock_timestamp(), a.expires_at),
      auto_points = result.score, awarded_points = result.score,
      graded_at = clock_timestamp(), approved_at = clock_timestamp()
  from (
    select coalesce(sum(q.points) filter (
      where current_attempt.answers ->> q.id::text = q.correct_option::text
    ), 0) as score
    from public.exam_attempts current_attempt
    join public.exam_questions q on q.exam_id = current_attempt.exam_id
    where current_attempt.id = attempt_id
  ) result
  where a.id = attempt_id and a.expires_at is not null and a.finished_at is null
  returning a.*;
$$;

create function exam_private.finish_expired()
returns void language plpgsql set search_path = '' as $$
declare attempt_id bigint;
begin
  for attempt_id in
    select id from public.exam_attempts
    where expires_at <= clock_timestamp() and finished_at is null
    order by expires_at limit 500 for update skip locked
  loop
    perform exam_private.finish_attempt(attempt_id);
  end loop;
end;
$$;

create function public.timed_exam_action(
  exam bigint, action text, username text default null,
  question bigint default null, choice integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  student uuid := auth.uid();
  current_exam public.academy_exams;
  attempt public.exam_attempts;
  started timestamptz;
  saving_attempt bigint;
  questions jsonb;
  percentage numeric;
  handle text := regexp_replace(btrim(username), '^@', '');
begin
  if student is null then raise exception 'Sign in to Midnimo Academy first'; end if;
  if action is null or action not in ('status','start','save','submit') then
    raise exception 'Invalid action';
  end if;
  select * into current_exam from public.academy_exams
    where id = exam and timed_exam;
  if not found then raise exception 'Exam unavailable'; end if;

  perform pg_advisory_xact_lock(hashtextextended(student::text || ':' || exam::text, 0));
  select * into attempt from public.exam_attempts
    where exam_id = exam and user_id = student and expires_at is not null
    order by attempt_number desc limit 1 for update;

  if attempt.id is null then
    if not current_exam.is_published then raise exception 'Exam unavailable'; end if;
    if action = 'status' then return jsonb_build_object('state','ready'); end if;
    if action <> 'start' then raise exception 'Start the exam first'; end if;
    if handle is null or handle !~ '^[A-Za-z0-9_]{1,32}$' then
      raise exception 'Enter your Telegram username';
    end if;
    if (select count(*) from public.exam_questions where exam_id = exam) <> 48 then
      raise exception 'Exam questions are unavailable';
    end if;
    started := clock_timestamp();
    insert into public.exam_attempts (exam_id, user_id, telegram_username, started_at, expires_at)
      values (exam, student, handle, started, started + interval '30 minutes')
      returning * into attempt;
  end if;

  if attempt.finished_at is null then
    if attempt.expires_at <= clock_timestamp() or action = 'submit' then
      select * into attempt from exam_private.finish_attempt(attempt.id);
    elsif action = 'save' then
      if choice is null or choice not between 0 and 3 or not exists (
        select 1 from public.exam_questions q where q.id = question and q.exam_id = exam
      ) then raise exception 'Invalid answer'; end if;
      saving_attempt := attempt.id;
      update public.exam_attempts
        set answers = jsonb_set(answers, array[question::text], to_jsonb(choice))
        where id = attempt.id and expires_at > clock_timestamp()
        returning * into attempt;
      if not found then
        select * into attempt from exam_private.finish_attempt(saving_attempt);
      else
        return jsonb_build_object('state','saved');
      end if;
    end if;
  end if;

  if attempt.finished_at is not null then
    percentage := 100 * attempt.awarded_points / current_exam.max_points;
    return jsonb_build_object('state','finished','score',attempt.awarded_points,
      'total',current_exam.max_points,'percentage',round(percentage,2),'passed',percentage >= 65);
  end if;

  select jsonb_agg(jsonb_build_object('id',q.id,'text',q.question_text,'options',q.answer_options)
      order by q.sort_order) into questions
    from public.exam_questions q where q.exam_id = exam;
  return jsonb_build_object('state','active','questions',questions,'answers',attempt.answers,
    'expires_at',attempt.expires_at,'server_now',clock_timestamp());
end;
$$;

revoke all on function public.timed_exam_action(bigint,text,text,bigint,integer) from public, anon, authenticated;
grant execute on function public.timed_exam_action(bigint,text,text,bigint,integer) to authenticated;

create extension if not exists pg_cron;
select cron.schedule('midnimo-final-exam-expiry', '5 seconds', 'select exam_private.finish_expired()');

insert into public.academy_exams
  (cohort_name, subject, title, max_points, instructions, timed_exam)
values
  ('General', 'fundamental', 'Final Fundamental Analysis Exam', 48,
   'Enter the username you use on Telegram. You have 30 minutes and need at least 65% to pass.', true);
