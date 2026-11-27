alter table public.exam_attempts
  add column student_name text,
  add column student_location text,
  add column student_gender text,
  add column student_email text;

create policy timed_exam_details_rpc_insert on public.exam_attempts
as restrictive for insert to authenticated
with check (student_name is null and student_location is null and student_gender is null and student_email is null);

create policy timed_exam_details_rpc_update on public.exam_attempts
as restrictive for update to authenticated
with check (student_name is null and student_location is null and student_gender is null and student_email is null);

drop function public.timed_exam_action(bigint,text,text,bigint,integer);

create function public.timed_exam_action(
  exam bigint, action text, username text default null,
  question bigint default null, choice integer default null, student_details jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  student uuid := auth.uid();
  current_exam public.academy_exams;
  attempt public.exam_attempts;
  started timestamptz;
  student_name text := btrim(student_details ->> 'name');
  student_location text := btrim(student_details ->> 'location');
  student_gender text := student_details ->> 'gender';
  student_email text;
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
      raise exception 'Enter your Telegram username or numeric ID';
    end if;
    if student_name is null or length(student_name) not between 1 and 120
       or student_location is null or length(student_location) not between 1 and 120
       or student_gender is null or student_gender not in ('Female','Male','Other','Prefer not to say') then
      raise exception 'Complete your name, location and gender before starting';
    end if;
    select u.email into student_email from auth.users u where u.id = student;
    if student_email is null or btrim(student_email) = '' then
      raise exception 'Add an email address to your Midnimo account before starting';
    end if;
    if (select count(*) from public.exam_questions where exam_id = exam) <> 48 then
      raise exception 'Exam questions are unavailable';
    end if;
    started := clock_timestamp();
    insert into public.exam_attempts (exam_id, user_id, telegram_username, started_at, expires_at,
      student_name, student_location, student_gender, student_email)
      values (exam, student, handle, started, started + interval '30 minutes',
        student_name, student_location, student_gender, student_email)
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

revoke all on function public.timed_exam_action(bigint,text,text,bigint,integer,jsonb) from public, anon, authenticated;
grant execute on function public.timed_exam_action(bigint,text,text,bigint,integer,jsonb) to authenticated;


update public.academy_exams
set instructions='Complete your student details and enter your Telegram username or numeric ID. You have 30 minutes and need at least 65% to pass.'
where id=4 and timed_exam and title='Final Fundamental Analysis Exam';
