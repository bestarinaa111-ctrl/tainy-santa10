'use strict';

const appRoot = document.getElementById('app');
const toastEl = document.getElementById('toast');
let toastTimer;
let resultPollTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function currencySymbol(currency) {
  return ({ RUB: '₽', USD: '$', EUR: '€' })[currency] || '₽';
}

function formatBudget(amount, currency) {
  return `${Number(amount).toLocaleString('ru-RU')} ${currencySymbol(currency)}`;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function setPage(html) {
  appRoot.innerHTML = html;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function displayError(container, message) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) return;
  target.innerHTML = `<div class="error-card">${escapeHtml(message)}</div>`;
}

function getRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'g' && parts[1]) {
    const code = parts[1].toUpperCase();
    if (parts[2] === 'admin') return { type: 'admin', code, token: window.location.hash.slice(1) };
    if (parts[2] === 'result') return { type: 'result', code, token: window.location.hash.slice(1) };
    return { type: 'join', code };
  }
  return { type: 'home' };
}

function renderHome() {
  setPage(`
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Праздник начинается здесь</span>
        <h1>Дарить —<br>это <em>волшебство.</em></h1>
        <p class="lead">Соберите друзей, выберите бюджет и позвольте новогоднему чуду решить, кто кому готовит подарок. Просто, красиво и по секрету.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#create">Создать игру <span>↗</span></a>
          <a class="text-link" href="#join">У меня есть приглашение</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-halo"></div><div class="art-ring"></div>
        <span class="gift-spark spark-one">✧</span><span class="gift-spark spark-two">✦</span><span class="gift-spark spark-three">✧</span>
        <div class="gift-illustration"><div class="gift-bow"></div><div class="gift-lid"></div><div class="gift-box"></div></div>
        <div class="hero-caption">Самое время загадать желание</div>
      </div>
    </section>
    <section class="feature-strip">
      <div class="feature"><span class="feature-icon">✦</span><div><strong>Всё по-честному</strong><span>Каждому — один получатель и один даритель</span></div></div>
      <div class="feature"><span class="feature-icon">♧</span><div><strong>Полная тайна</strong><span>Личный результат видит только участник</span></div></div>
      <div class="feature"><span class="feature-icon">♡</span><div><strong>Без регистрации</strong><span>Достаточно имени и личной ссылки</span></div></div>
    </section>
    <section class="panel-wrap" id="create" style="margin-top:72px">
      <div class="panel">
        <div class="panel-head"><span class="eyebrow">Для организатора</span><h2>Создать игру</h2><p class="lead">Задайте название и бюджет. После создания получите ссылку, которой можно поделиться с друзьями.</p></div>
        <form id="create-form">
          <div class="field"><label for="game-title">Название игры</label><input class="input" id="game-title" name="title" maxlength="60" value="Тайный Санта 2026" required placeholder="Например, Новый год с друзьями"></div>
          <div class="form-grid">
            <div class="field"><label for="game-budget">Бюджет подарка</label><input class="input" id="game-budget" name="budget" type="number" min="1" max="1000000" step="1" value="1500" required></div>
            <div class="field"><label for="game-currency">Валюта</label><select class="select" id="game-currency" name="currency"><option value="RUB">₽ Рубли</option><option value="USD">$ Доллары</option><option value="EUR">€ Евро</option></select></div>
          </div>
          <button class="button button-primary form-submit" type="submit">Создать игру <span>✦</span></button>
          <div id="create-error"></div>
        </form>
      </div>
    </section>
    <section class="panel-wrap" id="join" style="margin-top:22px">
      <div class="panel">
        <div class="panel-head"><span class="eyebrow">Уже приглашены?</span><h2 style="font-size:36px">Присоединиться к игре</h2><p class="lead">Введите код из ссылки-приглашения, чтобы записаться участником.</p></div>
        <form id="join-by-code-form">
          <div class="field"><label for="join-code">Код игры</label><input class="input" id="join-code" name="code" minlength="6" maxlength="10" placeholder="Например, AB12CD34" autocomplete="off" required></div>
          <button class="button button-outline form-submit" type="submit">Найти игру <span>→</span></button>
          <div id="join-code-error"></div>
        </form>
      </div>
    </section>
  `);

  document.getElementById('create-form').addEventListener('submit', createGame);
  document.getElementById('join-by-code-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6,10}$/.test(code)) {
      displayError('#join-code-error', 'Проверьте код: в нём должны быть латинские буквы и цифры.');
      return;
    }
    window.location.href = `/g/${code}`;
  });
}

async function createGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = 'Создаём игру…';
  document.getElementById('create-error').innerHTML = '';
  try {
    const result = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        title: formData.get('title'),
        budget: Number(formData.get('budget')),
        currency: formData.get('currency')
      })
    });
    const joinUrl = `${window.location.origin}/g/${result.code}`;
    const adminUrl = `${window.location.origin}/g/${result.code}/admin#${result.adminToken}`;
    renderCreatedGame(result.code, joinUrl, adminUrl);
  } catch (error) {
    displayError('#create-error', error.message);
    button.disabled = false;
    button.innerHTML = 'Создать игру <span>✦</span>';
  }
}

function renderCreatedGame(code, joinUrl, adminUrl) {
  setPage(`
    <div class="panel-wrap"><div class="panel center-page">
      <div class="success-icon">✦</div>
      <span class="eyebrow">Всё готово</span><h2>Ваша игра создана!</h2>
      <p class="lead">Отправьте друзьям ссылку-приглашение. А эту секретную ссылку организатора сохраните отдельно.</p>
      <div class="code-display">${escapeHtml(code)}</div>
      <div class="field" style="text-align:left"><label>Ссылка для участников</label><div class="link-box"><code>${escapeHtml(joinUrl)}</code><button class="button button-light button-small" type="button" data-copy="join">Копировать</button></div></div>
      <div class="notice"><strong>Важно!</strong> Секретная ссылка организатора даёт доступ к настройкам игры и запуску жеребьёвки. Не отправляйте её участникам. Сохраните её — восстановить эту ссылку нельзя.</div>
      <div class="field" style="text-align:left"><label>Личная ссылка организатора</label><div class="link-box"><code>${escapeHtml(adminUrl)}</code><button class="button button-light button-small" type="button" data-copy="admin">Копировать</button></div></div>
      <button class="button button-primary form-submit" id="open-admin">Открыть управление игрой <span>→</span></button>
    </div></div>
  `);
  document.querySelector('[data-copy="join"]').addEventListener('click', () => copyText(joinUrl));
  document.querySelector('[data-copy="admin"]').addEventListener('click', () => copyText(adminUrl));
  document.getElementById('open-admin').addEventListener('click', () => { window.location.href = adminUrl; });
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast('Ссылка скопирована');
  } catch {
    showToast('Не удалось скопировать. Выделите ссылку и скопируйте её вручную.');
  }
}

async function renderJoin(code) {
  setPage('<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">✧</div><h2>Открываем приглашение<span class="loading-dots"></span></h2><p class="lead">Проверяем, можно ли ещё присоединиться.</p></div></div>');
  try {
    const game = await api(`/api/games/${encodeURIComponent(code)}/public`);
    if (game.status !== 'open') {
      setPage(`<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">❄</div><span class="eyebrow">Запись закрыта</span><h2>${escapeHtml(game.title)}</h2><p class="lead">Жеребьёвка уже проведена. Новые участники больше не могут присоединиться.</p><a class="button button-outline" href="/">На главную</a></div></div>`);
      return;
    }
    setPage(`
      <div class="panel-wrap"><div class="panel">
        <div class="panel-head center-page"><span class="eyebrow">Вас пригласили</span><h2>${escapeHtml(game.title)}</h2><p class="lead">Вы присоединяетесь к игре «Тайный Санта». Введите своё имя — и вы в списке участников.</p></div>
        <div class="notice"><strong>Бюджет подарка:</strong> ${formatBudget(game.budget, game.currency)}<br><strong>Уже записались:</strong> ${game.participantCount}</div>
        <form id="join-form">
          <div class="field"><label for="participant-name">Ваше имя</label><input class="input" id="participant-name" name="name" maxlength="40" minlength="2" placeholder="Как вас будут видеть друзья?" autocomplete="name" required></div>
          <div class="field"><label for="participant-preferences">Предпочтения в подарках <span class="optional-label">(необязательно)</span></label><textarea class="input preferences-input" id="participant-preferences" name="preferences" maxlength="500" rows="3" placeholder="Например: люблю книги, чай и настольные игры; не хотелось бы сладости."></textarea><p class="field-hint">Это увидит только ваш Тайный Санта после жеребьёвки.</p></div>
          <div id="join-error"></div>
          <button class="button button-primary form-submit" type="submit">Присоединиться к игре <span>✦</span></button>
        </form>
        <p class="field-hint" style="text-align:center;margin-top:15px">Регистрация не нужна. После записи вы получите личную ссылку — сохраните её.</p>
      </div></div>
    `);
    document.getElementById('join-form').addEventListener('submit', (event) => joinGame(event, code));
  } catch (error) {
    setPage(`<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">✧</div><h2>Не нашли такую игру</h2><p class="lead">${escapeHtml(error.message)}</p><a class="button button-outline" href="/">Вернуться на главную</a></div></div>`);
  }
}

async function joinGame(event, code) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const name = formData.get('name');
  const preferences = formData.get('preferences');
  button.disabled = true;
  button.textContent = 'Добавляем вас…';
  document.getElementById('join-error').innerHTML = '';
  try {
    const result = await api(`/api/games/${encodeURIComponent(code)}/join`, {
      method: 'POST', body: JSON.stringify({ name, preferences })
    });
    const personalUrl = `${window.location.origin}/g/${code}/result#${result.participantToken}`;
    renderJoined(personalUrl);
    playSantaGreeting();
  } catch (error) {
    displayError('#join-error', error.message);
    button.disabled = false;
    button.innerHTML = 'Присоединиться к игре <span>✦</span>';
  }
}

function playSantaGreeting() {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const greeting = new SpeechSynthesisUtterance('Хо-хо-хо!');
    greeting.lang = 'ru-RU';
    greeting.rate = 0.82;
    greeting.pitch = 0.55;
    greeting.volume = 0.9;
    window.speechSynthesis.speak(greeting);
  } catch {
    // Озвучка необязательна: регистрация должна работать и без поддержки речи.
  }
}

function renderJoined(personalUrl) {
  setPage(`
    <div class="panel-wrap"><div class="panel center-page join-success">
      <div class="success-icon">✓</div><span class="eyebrow">Вы в игре</span><h2>Ура, вы записаны!</h2>
      <p class="lead">Теперь сохраните свою личную ссылку. После жеребьёвки по ней можно будет узнать, кому вы дарите подарок.</p>
      <div class="notice"><strong>Не потеряйте эту ссылку.</strong> Восстановить её без регистрации и пароля не получится. Никому не пересылайте её — по ней доступен только ваш результат.</div>
      <div class="link-box"><code>${escapeHtml(personalUrl)}</code><button class="button button-light button-small" id="copy-personal" type="button">Копировать</button></div>
      <button class="button button-primary form-submit" id="open-personal" type="button">Открыть мою страницу <span>→</span></button>
    </div></div>
  `);
  document.getElementById('copy-personal').addEventListener('click', () => copyText(personalUrl));
  document.getElementById('open-personal').addEventListener('click', () => { window.location.href = personalUrl; });
}

async function renderAdmin(code, token) {
  if (!token) {
    setPage('<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">🔒</div><h2>Нужна ссылка организатора</h2><p class="lead">Откройте именно секретную ссылку, которую сайт показал при создании игры. Обычная ссылка-приглашение не даёт доступа к управлению.</p><a class="button button-outline" href="/">На главную</a></div></div>');
    return;
  }
  setPage('<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">✦</div><h2>Открываем игру<span class="loading-dots"></span></h2></div></div>');
  try {
    const game = await api(`/api/games/${encodeURIComponent(code)}/admin`, { headers: { 'X-Admin-Token': token } });
    drawAdminPage(code, token, game);
  } catch (error) {
    setPage(`<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">🔒</div><h2>Не удалось открыть управление</h2><p class="lead">${escapeHtml(error.message)}</p><p class="field-hint">Проверьте, что используете сохранённую секретную ссылку организатора.</p></div></div>`);
  }
}

function drawAdminPage(code, token, game) {
  const isOpen = game.status === 'open';
  const participantsMarkup = game.participants.length
    ? game.participants.map((person, index) => `<li><span class="avatar">${index + 1}</span><span>${escapeHtml(person.name)}</span></li>`).join('')
    : '<li style="color:#98a097">Пока никто не записался. Отправьте приглашение друзьям.</li>';
  const joinUrl = `${window.location.origin}/g/${code}`;
  setPage(`
    <div class="panel-head" style="margin-bottom:25px"><span class="eyebrow">Панель организатора</span><h2>${escapeHtml(game.title)}</h2><p class="lead">Здесь виден список записавшихся, но не результаты жеребьёвки. Каждый участник узнает только своего получателя по личной ссылке.</p></div>
    <div class="admin-layout">
      <section class="card">
        <h3>Настройки игры</h3><p class="card-subtitle">${isOpen ? 'До жеребьёвки можно менять название и бюджет.' : 'Жеребьёвка уже проведена — настройки заблокированы.'}</p>
        <form id="settings-form">
          <div class="field"><label for="admin-title">Название</label><input class="input" id="admin-title" name="title" maxlength="60" value="${escapeHtml(game.title)}" ${isOpen ? '' : 'disabled'} required></div>
          <div class="form-grid">
            <div class="field"><label for="admin-budget">Бюджет</label><input class="input" id="admin-budget" name="budget" type="number" min="1" max="1000000" value="${game.budget}" ${isOpen ? '' : 'disabled'} required></div>
            <div class="field"><label for="admin-currency">Валюта</label><select class="select" id="admin-currency" name="currency" ${isOpen ? '' : 'disabled'}><option value="RUB" ${game.currency === 'RUB' ? 'selected' : ''}>₽ Рубли</option><option value="USD" ${game.currency === 'USD' ? 'selected' : ''}>$ Доллары</option><option value="EUR" ${game.currency === 'EUR' ? 'selected' : ''}>€ Евро</option></select></div>
          </div>
          ${isOpen ? '<button class="button button-outline form-submit" type="submit">Сохранить настройки</button>' : '<div class="notice">Бюджет зафиксирован: <strong>' + formatBudget(game.budget, game.currency) + '</strong></div>'}
          <div id="settings-error"></div>
        </form>
        <div class="admin-actions">
          <button class="button button-light" id="copy-invite" type="button">Скопировать приглашение</button>
          ${isOpen ? `<button class="button button-gold" id="draw-button" type="button" ${game.participants.length < 2 ? 'disabled' : ''}>Провести жеребьёвку ✦</button>` : '<span class="status-pill closed">Жеребьёвка завершена</span>'}
        </div>
        ${isOpen && game.participants.length < 2 ? '<p class="field-hint">Для запуска нужно минимум два участника.</p>' : ''}
        <div id="draw-error"></div>
      </section>
      <section class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><h3 style="margin:0">Участники</h3><span class="status-pill ${isOpen ? '' : 'closed'}">${isOpen ? 'Запись открыта' : 'Запись закрыта'}</span></div>
        <div class="participant-count"><span class="card-subtitle" style="margin:0">Всего записалось</span><strong>${game.participants.length}</strong></div>
        <ul class="participant-list">${participantsMarkup}</ul>
        <p class="field-hint" style="margin-top:14px">Список виден организатору. Результаты распределения здесь не отображаются.</p>
        ${isOpen ? '<button class="button button-outline button-small" id="refresh-admin" style="margin-top:15px" type="button">Обновить список ↻</button>' : ''}
      </section>
    </div>
  `);
  document.getElementById('copy-invite').addEventListener('click', () => copyText(joinUrl));
  const refreshButton = document.getElementById('refresh-admin');
  if (refreshButton) refreshButton.addEventListener('click', () => renderAdmin(code, token));
  const settingsForm = document.getElementById('settings-form');
  if (isOpen) settingsForm.addEventListener('submit', (event) => saveSettings(event, code, token));
  const drawButton = document.getElementById('draw-button');
  if (drawButton) drawButton.addEventListener('click', () => drawLots(code, token));
}

async function saveSettings(event, code, token) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const data = new FormData(event.currentTarget);
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  document.getElementById('settings-error').innerHTML = '';
  try {
    await api(`/api/games/${encodeURIComponent(code)}/admin`, {
      method: 'PATCH', headers: { 'X-Admin-Token': token },
      body: JSON.stringify({ title: data.get('title'), budget: Number(data.get('budget')), currency: data.get('currency') })
    });
    showToast('Настройки сохранены');
    renderAdmin(code, token);
  } catch (error) {
    displayError('#settings-error', error.message);
    button.disabled = false;
    button.textContent = 'Сохранить настройки';
  }
}

async function drawLots(code, token) {
  const confirmed = window.confirm('Провести жеребьёвку сейчас? После этого запись закроется, а бюджет и список участников нельзя будет изменить.');
  if (!confirmed) return;
  const button = document.getElementById('draw-button');
  button.disabled = true;
  button.textContent = 'Проводим жеребьёвку…';
  document.getElementById('draw-error').innerHTML = '';
  try {
    const result = await api(`/api/games/${encodeURIComponent(code)}/draw`, {
      method: 'POST', headers: { 'X-Admin-Token': token }, body: '{}'
    });
    showToast(`Готово! Распределено участников: ${result.participantCount}`);
    renderAdmin(code, token);
  } catch (error) {
    displayError('#draw-error', error.message);
    button.disabled = false;
    button.textContent = 'Провести жеребьёвку ✦';
  }
}

async function renderResult(code, token) {
  if (!token) {
    setPage('<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">🔒</div><h2>Это личная страница</h2><p class="lead">Чтобы увидеть результат, откройте личную ссылку, которую сайт выдал вам после записи в игру.</p><a class="button button-outline" href="/">На главную</a></div></div>');
    return;
  }
  await loadPersonalResult(code, token, true);
}

async function loadPersonalResult(code, token, firstLoad = false) {
  if (firstLoad) {
    setPage('<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">🎁</div><h2>Проверяем вашу страницу<span class="loading-dots"></span></h2><p class="lead">Только вы сможете увидеть свой результат.</p></div></div>');
  }
  try {
    const result = await api(`/api/games/${encodeURIComponent(code)}/me`, {
      headers: { 'X-Participant-Token': token }
    });
    if (result.status === 'open') {
      setPage(`
        <div class="panel-wrap"><div class="panel center-page">
          <div class="wait-icon">❄</div><span class="eyebrow">Ваша личная страница</span><h2>${escapeHtml(result.title)}</h2>
          <p class="lead">Вы уже в списке участников. Организатор ещё не запустил жеребьёвку — как только она состоится, здесь появится имя вашего получателя.</p>
          <div class="notice"><strong>Бюджет подарка:</strong> ${formatBudget(result.budget, result.currency)}<br>Сохраните эту личную ссылку, чтобы вернуться к результату позже.</div>
          <button class="button button-outline" id="check-result" type="button">Проверить ещё раз ↻</button>
        </div></div>
      `);
      document.getElementById('check-result').addEventListener('click', () => loadPersonalResult(code, token));
    } else {
      if (resultPollTimer) { window.clearInterval(resultPollTimer); resultPollTimer = null; }
      setPage(`
        <div class="panel-wrap center-page"><div class="result-card">
          <div class="result-icon">🎁</div><span class="eyebrow">Время готовить сюрприз</span><h2 style="margin-top:16px">Ваша тайна раскрыта</h2>
          <div class="separator"></div><div class="result-label">Вы дарите подарок</div>
          <div class="result-name">${escapeHtml(result.recipientName)}</div>
          ${result.recipientPreferences ? `<div class="recipient-preferences"><strong>Пожелания к подарку</strong><p>${escapeHtml(result.recipientPreferences).replace(/\n/g, '<br>')}</p></div>` : ''}
          <p class="lead" style="font-size:12px">Пусть ваш подарок принесёт радость и немного волшебства!</p>
          <div class="result-budget">Бюджет подарка: <strong>${formatBudget(result.budget, result.currency)}</strong></div>
        </div><p class="field-hint" style="margin-top:20px">Не показывайте эту страницу другим участникам — сохраните интригу до праздника.</p></div>
      `);
    }
  } catch (error) {
    if (firstLoad) setPage(`<div class="panel-wrap"><div class="panel center-page"><div class="wait-icon">🔒</div><h2>Не удалось открыть результат</h2><p class="lead">${escapeHtml(error.message)}</p><p class="field-hint">Проверьте, что вы открыли именно свою личную ссылку.</p></div></div>`);
    else showToast(error.message);
  }
}

function startApp() {
  const route = getRoute();
  if (route.type === 'home') renderHome();
  if (route.type === 'join') renderJoin(route.code);
  if (route.type === 'admin') renderAdmin(route.code, route.token);
  if (route.type === 'result') renderResult(route.code, route.token);

  // The result screen checks periodically so participants don't need to refresh manually.
  if (route.type === 'result' && route.token) {
    resultPollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadPersonalResult(route.code, route.token);
    }, 20_000);
  }
}

function createSeasonalEffects() {
  const layer = document.getElementById('snowfall');
  if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Keep the animation light enough for phones.
  const count = window.innerWidth < 600 ? 18 : 32;
  for (let i = 0; i < count; i += 1) {
    const flake = document.createElement('span');
    flake.className = 'snowflake';
    flake.textContent = i % 5 === 0 ? '✧' : '❄';
    flake.style.setProperty('--x', `${Math.random() * 100}%`);
    flake.style.setProperty('--size', `${7 + Math.random() * 10}px`);
    flake.style.setProperty('--opacity', `${0.22 + Math.random() * 0.48}`);
    flake.style.setProperty('--duration', `${9 + Math.random() * 13}s`);
    flake.style.setProperty('--delay', `${-Math.random() * 20}s`);
    flake.style.setProperty('--drift', `${-35 + Math.random() * 70}px`);
    layer.appendChild(flake);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  createSeasonalEffects();
  window.setTimeout(() => {
    loader.classList.add('done');
    document.getElementById('site-shell').classList.add('is-ready');
  }, 1100);
  startApp();
});
