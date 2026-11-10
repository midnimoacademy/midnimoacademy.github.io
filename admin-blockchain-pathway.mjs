import {$,client,formatDate,list,node,rpc,rubric} from './blockchain-pathway-ui.mjs';

const db = client();
let students = [], lessons = [], selected, content, readingRequest = 0;
const request = (action, learner=null, lesson=null, value=null) =>
  rpc(db,'admin',{p_action:action,p_learner:learner,p_lesson:lesson,p_value:value});
const lessonTitle = id => lessons.find(lesson=>lesson.id===id)?.title || 'Lesson '+id;

function renderRoster() {
  const filter = $('search').value.toLowerCase().trim();
  const results = students.filter(student=>student.name.toLowerCase().includes(filter));
  $('roster').replaceChildren(...results.map(student => {
    const record = node('div',undefined,{class:'record'});
    const button = node('button',student.name,{type:'button'});
    button.onclick = () => showStudent(student,true).catch(error=>{$('status').textContent=error.message;});
    record.append(button,node('p',student.completed+'/20 completed · Enrolled '+formatDate(student.enrolled_at)+
      (student.struggling ? ' · Needs support in '+student.struggling+' lesson(s) after repeated quiz attempts' : '')));
    return record;
  }));
  if (!results.length) $('roster').append(node('p','No matching enrolments.'));
}

async function loadRoster() {
  const result = await request('roster');
  students = result.students;
  lessons = result.lessons || [];
  $('stats').textContent = students.length+' enrolled · '+result.pending+' projects awaiting review · '+
    result.intermediate+' Intermediate certificates · '+result.advanced+' Advanced certificates';
  renderRoster();
}

function reviewForm(student, submission) {
  const form = node('form');
  const inputs = rubric(submission.lesson).map(criterion => {
    const label = node('label',criterion+' (0–25)');
    const input = node('input',undefined,{type:'number',min:'0',max:'25',step:'1',required:''});
    label.append(input); form.append(label);
    return input;
  });
  const label = node('label','Feedback to learner');
  const feedback = node('textarea',undefined,{required:'',minlength:'10',maxlength:'3000'});
  const button = node('button','Record review',{type:'submit'});
  const output = node('output',undefined,{class:'result','aria-live':'polite'});
  label.append(feedback);
  form.append(label,node('p','The project passes with at least 70/100 and at least 15/25 in every category. Lower marks return it for revision.'),button,output);
  form.onsubmit = async event => {
    event.preventDefault();
    button.disabled = true;
    try {
      await request('review',student.id,submission.lesson,{id:submission.id,grades:inputs.map(input=>Number(input.value)),feedback:feedback.value});
      await loadRoster();
      if (selected?.id===student.id) await showStudent(student);
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; }
  };
  return form;
}

async function showStudent(student, focus=false) {
  selected = student;
  $('student-panel').hidden = true;
  const record = await request('student',student.id);
  if (selected.id!==student.id) return;
  $('student-heading').textContent = student.name;
  $('student-panel').hidden = false;
  $('student').replaceChildren(
    node('h3','Lesson progress'),list(record.progress.map(item => lessonTitle(item.lesson)+' · '+item.sections.length+'/3 sections · '+
      item.best_score+'% best quiz · Practice '+(item.practice_passed?'passed':'outstanding')+
      (item.completed_at ? ' · Completed '+formatDate(item.completed_at) : ''))),
    node('h3','Recent quiz attempts'),list(record.attempts.map(item=>lessonTitle(item.lesson)+' · '+item.score+'% · '+formatDate(item.created_at))),
    node('h3','Practice and project submissions')
  );
  for (const item of record.submissions) {
    const panel = node('article',undefined,{class:'record'});
    panel.append(node('h4',lessonTitle(item.lesson)+' · '+item.decision.replace('_',' ')+' · '+formatDate(item.created_at)),node('p',item.evidence,{class:'prose'}));
    if (item.decision==='pending') panel.append(reviewForm(student,item));
    if (item.feedback) panel.append(node('p',item.grades.join(' / ')+' · '+item.feedback));
    $('student').append(panel);
  }
  $('audit').replaceChildren(node('h3','Exceptional unlock history'),list(record.unlocks.map(item =>
    lessonTitle(item.lesson)+' · '+formatDate(item.created_at)+' · '+item.detail.reason+' · Admin '+item.actor)));
  if (focus) $('student-heading').focus();
}

async function loadReading() {
  const current = ++readingRequest;
  content = null;
  $('reading').value = '';
  try {
    const result = await request('content',null,Number($('edit-lesson').value));
    if (current!==readingRequest) return;
    content = result;
    $('reading').value = content[$('edit-section').value].body;
    $('edit-result').textContent = '';
  } catch (error) {
    if (current===readingRequest) $('edit-result').textContent = error.message;
  }
}

$('unlock').onsubmit = async event => {
  event.preventDefault();
  const student = selected;
  const button = event.submitter;
  button.disabled = true;
  try {
    await request('unlock',student.id,Number($('unlock-lesson').value),$('reason').value);
    if (student.id!==selected?.id) return;
    $('unlock-result').textContent = 'Access recorded.';
    $('reason').value = '';
    await showStudent(student);
  } catch (error) { $('unlock-result').textContent = error.message; }
  finally { button.disabled = false; }
};

$('edit').onsubmit = async event => {
  event.preventDefault();
  if (!content) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const section = $('edit-section').value;
    const body = $('reading').value;
    await request('edit_reading',null,Number($('edit-lesson').value),{section,body});
    await loadReading();
    $('edit-result').textContent = 'Reading saved.';
  } catch (error) { $('edit-result').textContent = error.message; }
  finally { button.disabled = false; }
};

$('search').oninput = renderRoster;
$('edit-lesson').onchange = loadReading;
$('edit-section').onchange = () => { if(content) $('reading').value=content[$('edit-section').value].body; };

try {
  await loadRoster();
  for (const id of ['edit-lesson','unlock-lesson']) $(id).replaceChildren(...lessons.map(lesson=>node('option',lesson.title,{value:lesson.id})));
  $('workspace').hidden = false;
  $('status').textContent = '';
  await loadReading();
} catch (error) {
  $('status').textContent = error.code==='42501' || error.code==='PGRST202' ? 'Administrator sign-in is required.' : 'Could not load the administrator dashboard.';
  $('signin').hidden = false;
}
db.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT') location.replace('/student.html?next=admin');
});
