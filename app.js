const $ = id => document.getElementById(id);
const me = 'u_' + Math.random().toString(36).slice(2, 9);
const myName = 'Участник #' + Math.floor(100 + Math.random() * 899);

let mode = 'solo'; // 'solo' | 'group'
let st = 'home';   // 'home' | 'wait' | 'call' | 'group'
let soloPid = null;
let mic = null;
let muted = false;
let tmr = null;
let srch = null;
let sec = 0;

const peers = {};
const waitingPeople = {};
const grp = {};
const seen = new Set();

// 1. Закрытие плашки Cookie
if (localStorage.getItem('lk_ck_ok') === '1' && $('ckBox')) $('ckBox').classList.add('hide');
if ($('ckClose')) {
  $('ckClose').addEventListener('click', () => {
    localStorage.setItem('lk_ck_ok', '1');
    $('ckBox').classList.add('hide');
  });
}

// 2. Прямой встроенный WebSocket для поиска людей в РФ без внешних библиотек
let ws = null;
function connectSocket() {
  try {
    ws = new WebSocket('wss://://socketsbay.com');
    ws.onopen = () => {
      if ($('netBadge')) $('netBadge').textContent = '● Онлайн: В сети';
    };
    ws.onmessage = event => {
      let m = null;
      try { m = JSON.parse(event.data); } catch (e) { return; }
      if (!m || m.app !== 'likodopt_2026' || m.from === me || seen.has(m.id)) return;
      seen.add(m.id);
      handleSignal(m);
    };
    ws.onclose = () => {
      if ($('netBadge')) $('netBadge').textContent = '● Переподключение...';
      setTimeout(connectSocket, 2000);
    };
    ws.onerror = () => {};
  } catch (e) {}
}
connectSocket();

function sendSig(data) {
  if (!ws || ws.readyState !== 1) return;
  const id = me + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  try {
    ws.send(JSON.stringify({ app: 'likodopt_2026', id, from: me, name: myName, ts: Date.now(), ...data }));
  } catch (e) {}
}

// 3. Переключение экранов
function showScr(name) {
  clearInterval(tmr);
  sec = 0;
  ['sHome', 'sWait', 'sCall', 'sGroup'].forEach(id => $(id).classList.remove('on'));
  $(name).classList.add('on');

  if (name !== 'sHome') {
    tmr = setInterval(() => {
      sec++;
      const t = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      if (name === 'sWait') $('tWait').textContent = t;
      if (name === 'sCall') $('tCall').textContent = t;
      if (name === 'sGroup') $('tGroup').textContent = t;
    }, 1000);
  }
}

// 4. Переключение режимов Соло / Группа
function setMode(m) {
  if (st !== 'home') stopAll(false);
  mode = m;
  $('mSolo').classList.toggle('on', m === 'solo');
  $('mGroup').classList.toggle('on', m === 'group');
  $('hIco').textContent = m === 'solo' ? '🎙️' : '👥';
  $('hTitle').textContent = m === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6)';
  $('hSub').textContent = 'Нажмите «Найти / Далее», чтобы войти в комнату ожидания';
  showScr('sHome');
}

$('mSolo').addEventListener('click', () => setMode('solo'));
$('mGroup').addEventListener('click', () => setMode('group'));

function log(txt, cls) {
  const d = document.createElement('div');
  d.className = 'm ' + (cls || 'sys');
  d.textContent = txt;
  $('msgs').appendChild(d);
  $('msgs').scrollTop = 99999;
}

function renderLobby() {
  const list = $('lobbyList');
  list.innerHTML = '';
  const now = Date.now();
  Object.keys(waitingPeople).forEach(uid => {
    if (uid !== me && now - waitingPeople[uid].ts > 7000) delete waitingPeople[uid];
  });
  Object.keys(waitingPeople).forEach(uid => {
    const chip = document.createElement('div');
    chip.className = 'lobby-chip';
    chip.textContent = uid === me ? '🟢 Вы (' + myName + ')' : '⏳ ' + waitingPeople[uid].name;
    list.appendChild(chip);
  });
}

function draw6() {
  const g = $('gGrid');
  g.innerHTML = '';
  const ids = Object.keys(grp);
  $('gCount').textContent = ids.length;
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    if (ids[i]) {
      s.className = 'seat busy';
      s.innerHTML = '<span style="font-size:1.3rem">' + (ids[i] === me ? '🎙️' : '🎧') + '</span><span>' + (ids[i] === me ? 'Вы' : grp[ids[i]]) + '</span>';
    } else {
      s.className = 'seat';
      s.innerHTML = '<span style="font-size:1.3rem">➕</span><span>Свободно</span>';
    }
    g.appendChild(s);
  }
}

function closePeer(uid) {
  if (peers[uid]) { try { peers[uid].close(); } catch (e) {} delete peers[uid]; }
  const a = document.getElementById('a_' + uid);
  if (a) a.remove();
}

// 5. Кнопка «Найти / Далее» — открывает комнату ожидания
$('bNext').addEventListener('click', () => {
  stopAll(false);
  $('bStop').disabled = false;
  $('msgs').innerHTML = '';

  if (!mic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      mic = s;
      if (muted) mic.getAudioTracks().forEach(t => t.enabled = false);
      Object.values(peers).forEach(pc => mic.getTracks().forEach(t => pc.addTrack(t, mic)));
    }).catch(() => log('Микрофон недоступен — работает чат'));
  }

  if (mode === 'solo') {
    st = 'wait';
    waitingPeople[me] = { name: myName, ts: Date.now() };
    $('waitSub').textContent = 'Вы в комнате ожидания (режим 1 на 1)...';
    renderLobby();
    showScr('sWait');
    log('Вы вошли в комнату ожидания собеседника...');
    sendSig({ type: 'wait_solo' });
    srch = setInterval(() => {
      if (st === 'wait') {
        waitingPeople[me].ts = Date.now();
        renderLobby();
        sendSig({ type: 'wait_solo' });
      }
    }, 1200);
  } else {
    st = 'group';
    grp[me] = myName;
    draw6();
    showScr('sGroup');
    $('inp').disabled = false;
    $('bSend').disabled = false;
    log('Вы в групповой комнате ожидания и общения (до 6 чел.)');
    sendSig({ type: 'wait_group' });
    srch = setInterval(() => {
      if (st === 'group' && Object.keys(grp).length < 6) sendSig({ type: 'wait_group' });
    }, 1500);
  }
});

// 6. Кнопка «Стоп»
function stopAll(showUi) {
  clearInterval(srch);
  clearInterval(tmr);
  if (soloPid) sendSig({ to: soloPid, type: 'bye1' });
  if (st === 'group') Object.keys(grp).forEach(u => { if (u !== me) sendSig({ to: u, type: 'bye6' }); });
  Object.keys(peers).forEach(closePeer);
  for (const k in grp) delete grp[k];
  for (const k in waitingPeople) delete waitingPeople[k];
  soloPid = null;
  st = 'home';
  $('inp').disabled = true;
  $('bSend').disabled = true;

  if (showUi) {
    $('bStop').disabled = true;
    $('hTitle').textContent = 'Вы вышли из комнаты';
    showScr('sHome');
    log('Поиск остановлен');
  }
}

$('bStop').addEventListener('click', () => stopAll(true));

// 7. Кнопка «Выключить микрофон»
$('bMute').addEventListener('click', function() {
  muted = !muted;
  if (mic) mic.getAudioTracks().forEach(t => t.enabled = !muted);
  this.textContent = muted ? 'Включить микрофон' : 'Выключить микрофон';
  this.classList.toggle('on', muted);
});

// 8. Чат
$('cForm').addEventListener('submit', e => {
  e.preventDefault();
  const txt = $('inp').value.trim();
  if (!txt) return;
  if (st === 'call' && soloPid) {
    log(txt, 'me');
    sendSig({ to: soloPid, type: 'txt1', v: txt });
    $('inp').value = '';
  } else if (st === 'group') {
    log(txt, 'me');
    Object.keys(grp).forEach(u => { if (u !== me) sendSig({ to: u, type: 'txt6', v: txt }); });
    $('inp').value = '';
  }
});

async function rtc(to, init, kind) {
  closePeer(to);
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:://google.com' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  });
  peers[to] = pc;
  if (mic) mic.getTracks().forEach(t => pc.addTrack(t, mic));
  pc.ontrack = e => {
    let a = document.getElementById('a_' + to);
    if (!a) { a = document.createElement('audio'); a.id = 'a_' + to; a.autoplay = true; $('auds').appendChild(a); }
    a.srcObject = new MediaStream([e.track]);
    a.play().catch(() => {});
  };
  pc.onicecandidate = e => { if (e.candidate) sendSig({ to, type: 'ice', c: e.candidate }); };
  if (init) {
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sendSig({ to, type: 'off', o, kind });
  }
}

async function handleSignal(m) {
  if (m.type === 'wait_solo' && st === 'wait') {
    waitingPeople[m.from] = { name: m.name || 'Участник', ts: Date.now() };
    renderLobby();
    if (me > m.from) {
      st = 'call';
      soloPid = m.from;
      clearInterval(srch);
      sendSig({ to: soloPid, type: 'ok1' });
      showScr('sCall');
      $('inp').disabled = false;
      $('bSend').disabled = false;
      $('msgs').innerHTML = '';
      log('Собеседник найден! 👋');
      rtc(soloPid, true, 'solo');
    }
  } else if (m.to === me && m.type === 'ok1' && st === 'wait') {
    st = 'call';
    soloPid = m.from;
    clearInterval(srch);
    showScr('sCall');
    $('inp').disabled = false;
    $('bSend').disabled = false;
    $('msgs').innerHTML = '';
    log('Собеседник найден! 👋');
    rtc(soloPid, false, 'solo');
  } else if (m.type === 'wait_group' && st === 'group' && !grp[m.from] && Object.keys(grp).length < 6) {
    grp[m.from] = m.name || 'Участник';
    draw6();
    log(grp[m.from] + ' зашёл в комнату');
    sendSig({ to: m.from, type: 'here_group' });
    if (me > m.from) rtc(m.from, true, 'group');
  } else if (m.to === me && m.type === 'here_group' && st === 'group' && !grp[m.from] && Object.keys(grp).length < 6) {
    grp[m.from] = m.name || 'Участник';
    draw6();
    if (me > m.from) rtc(m.from, true, 'group');
  } else if (m.to === me) {
    if (m.type === 'off') {
      if (m.kind === 'group' && st === 'group' && !grp[m.from] && Object.keys(grp).length < 6) {
        grp[m.from] = m.name || 'Участник';
        draw6();
      }
      await rtc(m.from, false, m.kind);
      await peers[m.from].setRemoteDescription(new RTCSessionDescription(m.o));
      const a = await peers[m.from].createAnswer();
      await peers[m.from].setLocalDescription(a);
Отправляет сигнал({ кому: m.from, тип: 'ans', a });
} else if (m.type === 'ans' && peers[m.from]) {
ожидает peers[m.from].setRemoteDescription(новое RTCSessionDescription(m.a));
} else if (m.type === 'ice' && peers[m.from]) {
try { ожидает peers[m.from].addIceCandidate(новое RTCIceCandidate( m.c)); } catch (e) {}
} else if (m.type === 'txt1' && m.from === soloPid) {
log(m.v, 'он');
} else if (m.type === 'txt6' && st === 'group' && grp[m.from]) {
log(grp[m.from] + ': ' + m.v, 'он');
} else if (m.type === ' bye1' && m.from === soloPid) {
stopAll(true);
$('hTitle').textContent = 'Собеседник отключился';
} else if (m.type === 'bye6' && st === 'group' && grp[m.from]) {
log(grp[m.from] + ' вышел');
delete grp[m.from];
closePeer(m.from);
draw6();
}
}
}
