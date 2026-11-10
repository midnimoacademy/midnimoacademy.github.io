import {$,client,formatDate,labels,list,node,rpc,rubric} from './blockchain-pathway-ui.mjs';
import {simulator} from './blockchain-pathway-tools.mjs';

let db, dashboard, selected = 0, revision = 0;
const status = message => { $('status').textContent = message; };
const fragment = () => /^#lesson-(?:[1-9]|1[0-9]|20)$/.test(location.hash) ? Number(location.hash.slice(8)) : 0;

function errorMessage(error) {
  if (error.code === '42501') return 'Casharku waa xiran yahay ama oggolaanshahaaga ayaa dhammaaday.';
  if (error.code === '23505') return 'Mashruuc hore ayaa sugaya dib-u-eegis.';
  if (error.code === '22023') return 'Hubi inaad buuxisay dhammaan xogta loo baahan yahay.';
  return 'Xogta lama soo qaadi karin ama lama kaydin. Fadlan mar kale isku day.';
}

function renderDashboard() {
  $('enrol').hidden = dashboard.enrolled;
  $('workspace').hidden = !dashboard.enrolled;
  const done = dashboard.lessons.filter(lesson => lesson.completed_at).length;
  const intermediateDone = dashboard.lessons.filter(lesson => lesson.id <= 10 && lesson.completed_at).length === 10;
  $('progress').value = done;
  $('summary').textContent = 'Blockchain Development · ' + (intermediateDone ? 'Advanced' : 'Intermediate') +
    ' · ' + done + '/20 cashar (' + done*5 + '%)' + (done === 20 ? ' · Koorsada waa la dhammaystiray' : '');
  $('advanced-gate').hidden = intermediateDone;
  $('projects').textContent = dashboard.lessons.filter(lesson => lesson.project).map(lesson =>
    (lesson.id === 10 ? 'Intermediate' : 'Advanced') + ' project — ' +
    (labels[lesson.submission?.decision] || (lesson.available ? 'Weli lama gudbin' : 'Xiran'))
  ).join(' · ');
  for (const [key,start,end] of [['intermediate',1,10],['advanced',11,20]]) {
    $(key).replaceChildren(...dashboard.lessons.filter(item => item.id>=start && item.id<=end).map(item => {
      const li = node('li');
      const label = item.title + (item.completed_at ? ' · La dhammaystiray' : item.available ? '' : ' · Xiran');
      const entry = item.available ? node('a',label,{href:'#lesson-'+item.id}) : node('span',label,{class:'meta'});
      if (item.id===selected) entry.setAttribute('aria-current','step');
      li.append(entry);
      if (item.score !== null) li.append(node('small','Quiz ugu sarreeya: '+item.score+'%',{class:'meta'}));
      return li;
    }));
  }
  $('certificates').replaceChildren(...dashboard.certificates.map(certificate => {
    const box = node('article',undefined,{class:'record'});
    const url = '/blockchain-certificate.html?ref='+encodeURIComponent(certificate.reference);
    box.append(node('h3','Shahaadada Blockchain Development — '+certificate.level),node('p',certificate.full_name),
      node('p',formatDate(certificate.completed_at)),node('p','Verification reference · '+certificate.reference),
      node('a','Xaqiiji shahaadadan',{href:url,class:'no-print'}));
    return box;
  }));
  if (dashboard.certificates.length) {
    const print = node('button','Daabac shahaadooyinka',{type:'button',class:'no-print'});
    print.onclick = () => window.print();
    $('certificates').append(print);
  }
}

async function save(button, action, lesson, value, feedback, describe, updateView) {
  button.disabled = true;
  feedback.textContent = 'Waxaan kaydinaynaa…';
  try {
    const result = await rpc(db,'record',{p_action:action,p_lesson:lesson,p_value:value});
    feedback.textContent = describe(result);
    updateView(result);
  } catch (error) {
    feedback.textContent = errorMessage(error);
  } finally {
    button.disabled = false;
  }
  try {
    dashboard = await rpc(db,'dashboard');
    renderDashboard();
  } catch (error) {
    status(errorMessage(error));
    $('retry').hidden = false;
  }
}

function renderLesson(item, data) {
  const {content} = data;
  const heading = node('h2',data.title,{id:'lesson-title',tabindex:'-1'});
  const parts = [node('p',(item.id<=10?'Intermediate':'Advanced')+' · Casharka '+((item.id-1)%10+1)+' ee 10',{class:'meta'}),heading,
    node('h3','Ujeeddooyinka'),list(content.objectives)];
  for (const key of ['theory','example','review']) {
    const section = content[key];
    const panel = node('section',undefined,{class:'lesson-section'});
    panel.append(node('h3',section.title),node('p',section.body,{class:'prose'}));
    if (key==='example') {
      const diagram = node('figure',undefined,{class:'diagram'});
      diagram.append(node('figcaption',content.diagramTitle),list(content.diagram,'ol'));
      const code = node('pre');
      code.append(node('code',content.code));
      panel.append(diagram,code,node('p',content.codeNote,{class:'prose'}));
      const interactive = simulator(content.tool);
      if (interactive) panel.append(interactive);
    }
    const marked = item.sections.includes(key);
    const button = node('button',marked?'La dhammaystiray':'Calaamadee qaybta',{type:'button'});
    button.disabled = marked;
    const feedback = node('output',undefined,{class:'result','aria-live':'polite'});
    button.onclick = async () => {
      let saved = false;
      await save(button,'section',item.id,key,feedback,()=>'Qaybta waa la kaydiyey.',()=>{
        saved = true; button.textContent='La dhammaystiray';
      });
      button.disabled = saved;
    };
    panel.append(button,feedback);
    parts.push(panel);
  }

  const exercise = node('form',undefined,{class:'lesson-section'});
  exercise.append(node('h3',data.project?'Mashruuca la qiimaynayo':'Layliga la rabo'),
    node('p',content.exercise.instructions,{class:'prose'}),list(content.exercise.steps,'ol'));
  const evidence = node('label',content.exercise.prompt);
  const input = data.project
    ? node('textarea',undefined,{name:'evidence',required:'',minlength:'80',maxlength:'8000'})
    : node('input',undefined,{name:'evidence',required:'',maxlength:'200',autocomplete:'off'});
  evidence.append(input);
  const exerciseButton = node('button',data.project?'Gudbi mashruuca':'Hubi natiijada',{type:'submit'});
  const exerciseResult = node('output',item.submission ? labels[item.submission.decision] +
    (item.submission.grades ? ' · '+item.submission.grades.join(' / ') : '') +
    (item.submission.feedback ? ' · '+item.submission.feedback : '') : '',{class:'result','aria-live':'polite'});
  if (data.project) {
    exercise.append(node('p','Rubric: afar qodob oo midkiiba yahay 25 dhibcood. Gudubku wuxuu u baahan yahay 70/100 iyo ugu yaraan 15/25 qodob kasta.'),list(rubric(item.id)));
  }
  exercise.append(evidence,exerciseButton,exerciseResult);
  if (item.submission?.evidence) {
    const last = node('details');
    last.append(node('summary','Gudbintii ugu dambaysay · '+formatDate(item.submission.created_at)),
      node('p',item.submission.evidence,{class:'prose'}));
    exercise.append(last);
  }
  if (item.practice_passed || item.submission?.decision==='pending') {
    input.disabled = exerciseButton.disabled = true;
  }
  exercise.onsubmit = async event => {
    event.preventDefault();
    let locked = false;
    await save(exerciseButton,data.project?'project':'practice',item.id,input.value,exerciseResult,result =>
      result.decision==='pending'?'Mashruuca waa la gudbiyey. Sug dib-u-eegis.':
        result.decision==='passed'?'Layliga waa sax oo waa la kaydiyey.':'Jawaabta sax ma aha. Dib u tijaabi.',result => {
      locked = ['pending','passed'].includes(result.decision);
    });
    input.disabled = exerciseButton.disabled = locked;
  };

  const quiz = node('form',undefined,{class:'lesson-section'});
  quiz.append(node('h3','Imtixaanka casharka'),node('p','Ugu yaraan 70% ayaa loo baahan yahay. Waxaad ku celin kartaa imtixaanka.'));
  content.quiz.forEach(({question,options},index)=>{
    const field = node('fieldset');
    field.append(node('legend',(index+1)+'. '+question));
    options.forEach((option,value)=>{
      const label = node('label',undefined,{class:'choice'});
      label.append(node('input',undefined,{type:'radio',name:'q'+index,value,required:''}),node('span',option));
      field.append(label);
    });
    quiz.append(field);
  });
  const quizButton = node('button','Gudbi jawaabaha',{type:'submit'});
  const quizResult = node('output',item.score === null ? '' : 'Dhibcahaaga ugu sarreeya: '+item.score+'%',{class:'result','aria-live':'polite'});
  quiz.append(quizButton,quizResult);
  if (item.attempts.length) {
    const attempts = node('details');
    attempts.append(node('summary','Isku-dayadii ugu dambeeyey'),list(item.attempts.map(attempt=>
      attempt.score+'% · '+formatDate(attempt.created_at))));
    quiz.append(attempts);
  }
  quiz.onsubmit = async event => {
    event.preventDefault();
    const fields = new FormData(quiz);
    await save(quizButton,'quiz',item.id,content.quiz.map((_,i)=>Number(fields.get('q'+i))),quizResult,
      result => result.score+'% · '+(result.score>=70?'Waad gudubtay.':'Dib u eeg casharka oo mar kale isku day.'),()=>{});
  };
  const sources = node('ul');
  for (const [title,url] of content.references) {
    const li = node('li');
    const safeUrl = new URL(url);
    if (safeUrl.protocol==='https:') li.append(node('a',title,{href:safeUrl.href,rel:'noopener noreferrer',target:'_blank'}));
    sources.append(li);
  }
  $('lesson').replaceChildren(...parts,exercise,quiz,node('h3','Tixraacyada farsamada'),sources);
  $('lesson').hidden = false;
  if (location.hash) {
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:'start'});
  }
}

async function openLesson() {
  const request = ++revision;
  selected = fragment() || dashboard.lessons.find(item => item.available && !item.completed_at)?.id ||
    [...dashboard.lessons].reverse().find(item => item.available)?.id || 0;
  renderDashboard();
  $('lesson').hidden = true;
  $('lesson').replaceChildren();
  $('retry').hidden = true;
  status('');
  if (!dashboard.enrolled || !selected) return;
  const item = dashboard.lessons.find(row=>row.id===selected);
  status('Waxaan soo qaadaynaa casharka…');
  try {
    const data = await rpc(db,'lesson',{p_lesson:selected});
    if (request !== revision) return;
    if (!item || !data) throw new Error('Lesson data missing');
    renderLesson(item,data);
    status('');
  } catch (error) {
    if (request !== revision) return;
    status(errorMessage(error));
    $('retry').hidden = false;
  }
}

async function refresh() {
  try {
    dashboard = await rpc(db,'dashboard');
    await openLesson();
  } catch (error) {
    status(errorMessage(error));
    $('retry').hidden = false;
  }
}

if (await window.midnimoBlockchainAccess) {
  db = client();
  $('retry').onclick = refresh;
  $('enrol-button').onclick = async () => {
    $('enrol-button').disabled = true;
    try { await rpc(db,'record',{p_action:'enrol'}); await refresh(); }
    catch (error) { status(errorMessage(error)); }
    finally { $('enrol-button').disabled = false; }
  };
  window.addEventListener('hashchange',()=>{ if (dashboard) void openLesson(); });
  db.auth.onAuthStateChange(event => {
    if (event==='SIGNED_OUT') {
      ++revision;
      $('lesson').replaceChildren();
      $('workspace').hidden = true;
      location.replace('/student.html?next=%2Fblockchain-pathway.html');
    }
  });
  await refresh();
}
