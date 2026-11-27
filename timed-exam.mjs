export function mountTimedExam(container, db, exam, userId) {
  const storageKey = 'midnimo-timed-exam:' + exam.id + ':' + userId;
  const pending = new Map();
  try {
    for (const entry of JSON.parse(sessionStorage.getItem(storageKey) || '[]')) {
      pending.set(...entry);
    }
  } catch {
    pending.clear();
  }

  function remember() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...pending]));
    } catch {
      // The server still saves answers when browser storage is unavailable.
    }
  }

  function append(parent, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  append(container, 'p', exam.instructions);
  append(container, 'p', '48 questions · One attempt · Your Telegram username is used to identify your result.');
  const clock = append(container, 'p', '');
  clock.className = 'timed-clock';
  const status = append(container, 'p', 'Loading exam…');
  status.setAttribute('role', 'status');
  const body = append(container, 'div', '');
  let active = false;
  let deadline = 0;
  let timer;
  let saving;

  async function call(action, args = {}) {
    const { data, error } = await db.rpc('timed_exam_action', { exam: exam.id, action, ...args });
    if (error) throw new Error(error.message);
    return data;
  }

  function showResult(result) {
    active = false;
    clearInterval(timer);
    pending.clear();
    remember();
    body.replaceChildren();
    clock.textContent = '';
    status.textContent = 'Exam submitted.';
    append(body, 'h4', result.passed ? 'PASS' : 'FAIL');
    append(body, 'p', result.score + '/' + result.total + ' correct · ' + Number(result.percentage).toFixed(2) + '%');
  }

  function flush() {
    if (saving) return saving;
    if (!active || !pending.size || performance.now() >= deadline) return Promise.resolve();
    saving = (async () => {
      try {
        while (active && pending.size && performance.now() < deadline) {
          const [question, choice] = pending.entries().next().value;
          const result = await call('save', { question, choice });
          if (result.state === 'finished') {
            showResult(result);
            return;
          }
          if (pending.get(question) === choice) pending.delete(question);
          remember();
        }
        if (active && !pending.size) status.textContent = 'Answers saved.';
      } catch {
        status.textContent = 'Answer sync interrupted. Reconnecting before the deadline.';
      } finally {
        saving = undefined;
      }
    })();
    return saving;
  }

  async function finish() {
    const result = await call('submit');
    showResult(result);
  }

  function showActive(result, requestStarted) {
    body.replaceChildren();
    active = true;
    deadline = requestStarted + Date.parse(result.expires_at) - Date.parse(result.server_now);
    const form = append(body, 'form', '');
    for (const [index, question] of result.questions.entries()) {
      const fieldset = append(form, 'fieldset', '');
      fieldset.className = 'timed-question';
      append(fieldset, 'legend', (index + 1) + '. ' + question.text);
      for (const [choice, option] of question.options.entries()) {
        const label = append(fieldset, 'label', '');
        const input = append(label, 'input', '');
        input.type = 'radio';
        input.name = 'question-' + question.id;
        input.value = String(choice);
        input.checked = (pending.get(question.id) ?? result.answers[question.id]) === choice;
        label.append(' ' + option);
        input.onchange = () => {
          if (!active || performance.now() >= deadline) return;
          pending.set(question.id, choice);
          remember();
          status.textContent = 'Saving answers…';
          flush();
        };
      }
    }

    const submit = append(form, 'button', 'Submit exam');
    form.onsubmit = async event => {
      event.preventDefault();
      if (!confirm('Submit your exam and view the result?')) return;
      submit.disabled = true;
      await flush();
      if (!active) return;
      // At expiry the server still grades whatever it saved before the cutoff.
      if (pending.size && performance.now() < deadline) {
        status.textContent = 'Some answers are waiting to sync. Try again when connected.';
        submit.disabled = false;
        return;
      }
      try {
        await finish();
      } catch {
        status.textContent = 'Could not submit. Reconnect and try again.';
        submit.disabled = false;
      }
    };

    let checkingExpiry = false;
    async function tick() {
      if (!active) return;
      const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      clock.textContent = 'Time remaining ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      if (seconds === 0) {
        for (const input of form.elements) input.disabled = true;
        if (checkingExpiry) return;
        checkingExpiry = true;
        status.textContent = 'Time expired. Retrieving your result…';
        try {
          const result = await call('status');
          if (result.state === 'finished') showResult(result);
        } catch {
          status.textContent = 'Time expired. Reconnect to view your result.';
        } finally {
          checkingExpiry = false;
        }
      } else if (pending.size) {
        await flush();
      }
    }
    status.textContent = 'Answers save automatically.';
    timer = setInterval(tick, 1000);
    tick();
  }

  function showReady() {
    status.textContent = '';
    const form = append(body, 'form', '');
    const label = append(form, 'label', 'Telegram username');
    const username = append(label, 'input', '');
    username.className = 'timed-username';
    username.required = true;
    username.maxLength = 33;
    username.pattern = '@?[A-Za-z0-9_]{1,32}';
    username.autocapitalize = 'none';
    username.spellcheck = false;
    username.placeholder = '@username';
    const start = append(form, 'button', 'Start 30-minute exam');
    form.onsubmit = async event => {
      event.preventDefault();
      start.disabled = true;
      try {
        const requestStarted = performance.now();
        const result = await call('start', { username: username.value });
        if (result.state === 'finished') showResult(result);
        else showActive(result, requestStarted);
      } catch (error) {
        status.textContent = error.message;
        start.disabled = false;
      }
    };
  }

  const requestStarted = performance.now();
  call('status').then(result => {
    if (result.state === 'ready') showReady();
    else if (result.state === 'finished') showResult(result);
    else showActive(result, requestStarted);
  }).catch(error => {
    status.textContent = error.message;
    const retry = append(body, 'button', 'Reload exam');
    retry.onclick = () => location.reload();
  });
}
