const $ = id => document.getElementById(id);
const RELAY = 'https://ntfy.sh';
const me = 'u_' + Math.random().toString(36).slice(2, 9);
const myName = 'Участник #' + Math.floor(100 + Math.random() * 899);

let mode = 'solo';
let st = 'home';
let soloPid = null;
let mic = null;
let muted = false;
let tmr = null;
let srch = null;
let sec = 0;

const peers = {};
const grp = {};
const seen = new Set();

// 1. Закрытие плашки Cookie
if (localStorage.getItem('lk_ck_ok') === '1') $('ckBox').style.display = 'none';
$('ckClose').onclick = () => {
  localStorage.setItem('lk_ck_ok', '1');
  $('ckBox').style.display = 'none';
};

// 2. Переключение экранов
function showScr(name) {
  clearInterval(tmr);
  sec = 0;
  ['sHome', 'sSearch', 'sCall', 'sGroup'].forEach(id => $(id).classList.remove('on'));
  $(name).classList.add('on');

  if (name !== 'sHome') {
    tmr = setInterval(() => {
      sec++;
      const t = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      if (name === 'sSearch') $('tSearch').textContent = 'Время поиска: ' + t;
      if (name === 'sCall') $('tCall').textContent = '● Разговор: ' + t;
      if (name === 'sGroup') $('tGroup').textContent = '● Комната (' + Object.keys(grp).length + '/6) • ' + t;
    }, 1000);
  }
}

// 3. Переключение режимов Соло / Группа
function setMode(m) {
  if (st !== 'home') stopAll(false);
  mode = m;
  $('mSolo').classList.toggle('on', m === 'solo');
  $('mGroup').classList.toggle('on', m === 'group');
  $('hIco').textContent = m === 'solo' ? '🎙️' : '👥';
  $('hTitle').textContent = m === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6)';
  $('hSub').textContent = 'Нажмите «Найти / Далее»';
  showScr('sHome');
}

$('mSolo').onclick = () => setMode('solo');
$('mGroup').onclick = () => setMode('group');

function log(txt, cls) {
  const d = document.createElement('div');
  d.className = 'm ' + (cls || 'sys');
  d.textContent = txt;
  $('msgs').appendChild(d);
  $('msgs').scrollTop = 99999;
}

function draw6() {
  const g = $('gGrid');
  g.innerHTML = '';
  const ids = Object.keys(grp);
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    if (ids[i]) {
      s.className = 'seat busy';
      s.textContent = ids[i] === me ? '🎙️ Вы' : '🎧 ' + grp[ids[i]];
    } else {
      s.className = 'seat';
      s.textContent = '➕ Свободно';
    }
    g.appendChild(s);
  }
}

function sendSig(data) {
  const id = me + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  fetch(RELAY, {
    method: 'POST',
    body: JSON.stringify({ id, from: me, name: myName, ts: Date.now(), ...data })
  }).catch(() => {});
}

function closePeer(uid) {
  if (peers[uid]) { try { peers[uid].close(); } catch (e) {} delete peers[uid]; }
  const a = document.getElementById('a_' + uid);
  if (a) a.remove();
}

// 4. Кнопка «Найти / Далее»
$('bNext').onclick = () => {
  stopAll(false);
  $('bStop').disabled = false;
  $('msgs').innerHTML = '';

  if (!mic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      mic = s;
      if (muted) mic.getAudioTracks().forEach(t => t.enabled = false);
    }).catch(() => log('Микрофон недоступен — работает чат'));
  }

  if (mode === 'solo') {
    st = 'search';
    $('tSearch').textContent = 'Время поиска: 00:00';
    showScr('sSearch');
    log('Поиск свободного собеседника...');
    sendSig({ type: 'seek1' });
    srch = setInterval(() => { if (st === 'search') sendSig({ type: 'seek1' }); }, 1500);
  } else {
    st = 'group';
    grp[me] = myName;
    draw6();
    $('tGroup').textContent = '● Комната (1/6) • 00:00';
    showScr('sGroup');
    $('inp').disabled = false;
    $('bSend').disabled = false;
    log('Вы в групповой комнате (до 6 чел.)');
    sendSig({ type: 'seek6' });
    srch = setInterval(() => { if (st === 'group' && Object.keys(grp).length < 6) sendSig({ type: 'seek6' }); }, 2000);
  }
};

// 5. Кнопка «Стоп»
function stopAll(showUi) {
  clearInterval(srch);
  clearInterval(tmr);
  if (soloPid) sendSig({ to: soloPid, type: 'bye1' });
  if (st === 'group') Object.keys(grp).forEach(u => { if (u !== me) sendSig({ to: u, type: 'bye6' }); });
  Object.keys(peers).forEach(closePeer);
  for (const k in grp) delete grp[k];
  soloPid = null;
  st = 'home';
  $('inp').disabled = true;
  $('bSend').disabled = true;

  if (showUi) {
    $('bStop').disabled = true;
    $('hTitle').textContent = 'Поиск остановлен';
    showScr('sHome');
    log('Вы вышли из комнаты');
  }
}

$('bStop').onclick = () => stopAll(true);

// 6. Кнопка «Выключить микрофон»
$('bMute').onclick = function() {
  muted = !muted;
  if (mic) mic.getAudioTracks().forEach(t => t.enabled = !muted);
  this.textContent = muted ? 'Включить микрофон' : 'Выключить микрофон';
  this.classList.toggle('on', muted);
};

// 7. Отправка сообщений
$('cForm').onsubmit = e => {
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
};

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

async function poll() {
  try {
    const r = await fetch(RELAY + '/json?poll=1&since=12s');
    if (r.ok) {
      const lines = (await r.text()).trim().split('\n');
      for (const l of lines) {
        if (!l) continue;
        const w = JSON.parse(l);
        if (!w.message) continue;
        const m = JSON.parse(w.message);
        if (!m || m.from === me || seen.has(m.id) || Date.now() - m.ts > 16000) continue;
        seen.add(m.id);

        if (m.type === 'seek1' && st === 'search' && me > m.from) {
          st = 'call'; soloPid = m.from; clearInterval(srch);
          sendSig({ to: soloPid, type: 'ok1' });
          $('tCall').textContent = '● Разговор: 00:00';
          showScr('sCall');
          $('inp').disabled = false; $('bSend').disabled = false;
          $('msgs').innerHTML = ''; log('Собеседник найден! 👋');
          rtc(soloPid, true, 'solo');
        } else if (m.to === me && m.type === 'ok1' && st === 'search') {
          st = 'call'; soloPid = m.from; clearInterval(srch);
          $('tCall').textContent = '● Разговор: 00:00';
          showScr('sCall');
          $('inp').disabled = false; $('bSend').disabled = false;
          $('msgs').innerHTML = ''; log('Собеседник найден! 👋');
          rtc(soloPid, false, 'solo');
        } else if (m.type === 'seek6' && st === 'group' && !grp[m.from] && Object.keys(grp).length < 6) {
          grp[m.from] = m.name || 'Участник';
          draw6();
          log(grp[m.from] + ' зашёл в комнату');
          if (me > m.from) rtc(m.from, true, 'group');
        } else if (m.to === me) {
          if (m.type === 'off') {
            if (m.kind === 'group' && st === 'group' && !grp[m.from] && Object.keys(grp).length < 6) {
              grp[m.from] = m.name || 'Участник'; draw6();
            }
            await rtc(m.from, false, m.kind);
            await peers[m.from].setRemoteDescription(new RTCSessionDescription(m.o));
            const a = await peers[m.from].createAnswer();
            await peers[m.from].setLocalDescription(a);
            sendSig({ to: m.from, type: 'ans', a });
          } else if (m.type === 'ans' && peers[m.from]) await peers[m.from].setRemoteDescription(new RTCSessionDescription(m.a));
          else if (m.type === 'ice' && peers[m.from]) try { await peers[m.from].addIceCandidate(new RTCIceCandidate(m.c)); } catch (e) {}
          else if (m.type === 'txt1' && m.from === soloPid) log(m.v, 'he');
          else if (m.type === 'txt6' && st === 'group' && grp[m.from]) log(grp[m.from] + ': ' + m.v, 'he');
          else if (m.type === 'bye1' && m.from === soloPid) { stopAll(true); $('hTitle').textContent = 'Собеседник отключился'; }
          else if (m.type === 'bye6' && st === 'group' && grp[m.from]) { log(grp[m.from] + ' вышел'); delete grp[m.from]; closePeer(m.from); draw6(); }
        }
      }
    }
  } catch (e) {}
  setTimeout(poll, 1000);
}

poll();
