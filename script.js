const $ = id => document.getElementById(id);
const SIGNAL_URL = 'https://ntfy.sh';
const me = 'u_' + Math.random().toString(36).slice(2, 9);
const myName = 'Участник #' + Math.floor(100 + Math.random() * 899);

let mode = 'solo';
let st = 'home';
let soloPid = null;
let groupRoomId = null;
let mic = null;
let muted = false;
let tInt = null;
let sInt = null;
let sec = 0;

const peers = {};
const groupMembers = {};
const seen = new Set();

// Закрытие плашки Cookie
if (localStorage.getItem('lk_ck') === '1' && $('ckBox')) {
  $('ckBox').style.display = 'none';
}
if ($('ckClose')) {
  $('ckClose').onclick = () => {
    localStorage.setItem('lk_ck', '1');
    if ($('ckBox')) $('ckBox').style.display = 'none';
  };
}

// Переключение между Соло и Групповым
function setMode(newMode) {
  if (st !== 'home') clickStop(false);
  mode = newMode;
  $('mSolo').classList.toggle('active', mode === 'solo');
  $('mGroup').classList.toggle('active', mode === 'group');
  $('homeIco').textContent = mode === 'solo' ? '🎙️' : '👥';
  $('hTitle').textContent = mode === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6 чел.)';
  $('hSub').textContent = mode === 'solo' ? 'Один на один со случайным собеседником' : 'Общая голосовая комната до 6 человек';
  goScr('home');
}

$('mSolo').onclick = () => setMode('solo');
$('mGroup').onclick = () => setMode('group');

// Переключение экранов
function goScr(name) {
  clearInterval(tInt);
  sec = 0;
  ['sHome', 'sSearch', 'sCall', 'sGroup'].forEach(id => $(id).classList.remove('on'));
  const map = { home: 'sHome', search: 'sSearch', call: 'sCall', group: 'sGroup' };
  $(map[name]).classList.add('on');

  if (name === 'search' || name === 'call' || name === 'group') {
    const elId = name === 'search' ? 'tSearch' : (name === 'call' ? 'tCall' : 'tGroup');
    const el = $(elId);
    el.textContent = '00:00';
    tInt = setInterval(() => {
      sec++;
      el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    }, 1000);
  }
}

function renderGroupGrid() {
  const grid = $('groupGrid');
  grid.innerHTML = '';
  const ids = Object.keys(groupMembers);
  $('grpCount').textContent = ids.length;

  for (let i = 0; i < 6; i++) {
    const seat = document.createElement('div');
    if (ids[i]) {
      const uid = ids[i];
      seat.className = 'seat occupied';
      seat.innerHTML = '<span class="seat-ico">' + (uid === me ? '🎙️' : '🎧') + '</span><span>' + (uid === me ? 'Вы' : groupMembers[uid]) + '</span>';
    } else {
      seat.className = 'seat';
      seat.innerHTML = '<span class="seat-ico">➕</span><span>Свободно</span>';
    }
    grid.appendChild(seat);
  }
}

function log(txt, cls) {
  const d = document.createElement('div');
  d.className = 'm ' + (cls || 'sys');
  d.textContent = txt;
  const box = $('msgs');
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function chatOn(on) {
  $('inp').disabled = !on;
  $('bSend').disabled = !on;
}

function sendSig(payload) {
  const mid = me + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  fetch(SIGNAL_URL, {
    method: 'POST',
    body: JSON.stringify({ mid, f: me, name: myName, t: Date.now(), ...payload })
  }).catch(() => {});
}

function closePeer(uid) {
  if (peers[uid]) {
    try { peers[uid].close(); } catch (e) {}
    delete peers[uid];
  }
  const aud = document.getElementById('aud_' + uid);
  if (aud) aud.remove();
}

// Кнопка Найти / Далее
$('bNext').onclick = function() {
  clickStop(false);
  $('bStop').disabled = false;
  $('msgs').innerHTML = '';

  if (!mic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      mic = s;
      if (muted) mic.getAudioTracks().forEach(tr => tr.enabled = false);
      Object.values(peers).forEach(pc => mic.getTracks().forEach(tr => pc.addTrack(tr, mic)));
    }).catch(() => log('Микрофон отключен — работает текстовый чат'));
  }

  if (mode === 'solo') {
    st = 'search';
    goScr('search');
    log('Поиск свободного собеседника (1 на 1)...');
    sendSig({ tp: 'seek_solo' });
    sInt = setInterval(() => {
      if (st === 'search') sendSig({ tp: 'seek_solo' });
    }, 1500);
  } else {
    st = 'group';
    goScr('group');
    chatOn(true);
    groupMembers[me] = myName;
    renderGroupGrid();
    log('Вы вошли в групповую комнату (до 6 мест)...');
    sendSig({ tp: 'seek_group' });
    sInt = setInterval(() => {
      if (st === 'group' && Object.keys(groupMembers).length < 6) {
        sendSig({ tp: 'seek_group' });
      }
    }, 2000);
  }
};

// Кнопка Стоп
function clickStop(showUi) {
  clearInterval(sInt);
  if (soloPid) sendSig({ to: soloPid, tp: 'bye' });
  if (st === 'group') {
    Object.keys(groupMembers).forEach(uid => {
      if (uid !== me) sendSig({ to: uid, tp: 'g_bye' });
    });
  }

  Object.keys(peers).forEach(closePeer);
  for (const k in groupMembers) delete groupMembers[k];

  soloPid = null;
  st = 'home';
  chatOn(false);

  if (showUi) {
    $('bStop').disabled = true;
    $('hTitle').textContent = 'Диалог завершён';
    goScr('home');
    log('Вы вышли из комнаты');
  }
}
$('bStop').onclick = () => clickStop(true);

// Кнопка Мут микрофона
$('bMute').onclick = function() {
  muted = !muted;
  if (mic) mic.getAudioTracks().forEach(tr => tr.enabled = !muted);
  this.textContent = muted ? 'Включить микрофон' : 'Выключить микрофон';
  this.classList.toggle('on', muted);
};

// Отправка текста
$('chatForm').onsubmit = function(e) {
  e.preventDefault();
  const inp = $('inp');
  const txt = inp.value.trim();
  if (!txt) return;

  if (st === 'call' && soloPid) {
    log(txt, 'me');
    sendSig({ to: soloPid, tp: 'txt', v: txt });
    inp.value = '';
  } else if (st === 'group') {
    log(txt, 'me');
    Object.keys(groupMembers).forEach(uid => {
      if (uid !== me) sendSig({ to: uid, tp: 'g_txt', v: txt });
    });
    inp.value = '';
  }
};

// WebRTC соединение
async function createRtcWith(targetId, isInitiator, callType) {
  closePeer(targetId);
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:://google.com' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  });
  peers[targetId] = pc;

  if (mic) mic.getTracks().forEach(tr => pc.addTrack(tr, mic));

  pc.ontrack = e => {
    let aud = document.getElementById('aud_' + targetId);
    if (!aud) {
      aud = document.createElement('audio');
      aud.id = 'aud_' + targetId;
      aud.autoplay = true;
      aud.playsInline = true;
      $('audioPool').appendChild(aud);
    }
    aud.srcObject = new MediaStream([e.track]);
    aud.play().catch(() => {});
  };

  pc.onicecandidate = e => {
    if (e.candidate) sendSig({ to: targetId, tp: 'c', c: e.candidate });
  };

  if (isInitiator) {
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sendSig({ to: targetId, tp: 'o', o, callType });
  }
}

// Получение сигналов
async function poll() {
  try {
    const r = await fetch(SIGNAL_URL + '/json?poll=1&since=12s');
    if (r.ok) {
      const lines = (await r.text()).trim().split('\n');
      for (const l of lines) {
        if (!l) continue;
        const w = JSON.parse(l);
        if (!w.message) continue;
        const m = JSON.parse(w.message);
        if (!m || m.f === me || seen.has(m.mid) || Date.now() - m.t > 16000) continue;
        seen.add(m.mid);

        if (m.tp === 'seek_solo' && st === 'search' && me > m.f) {
          st = 'conn';
          soloPid = m.f;
          clearInterval(sInt);
          sendSig({ to: soloPid, tp: 'ok_solo' });
          st = 'call';
          goScr('call');
          chatOn(true);
          $('msgs').innerHTML = '';
          log('Собеседник найден! Вы в комнате 1 на 1 👋');
          createRtcWith(soloPid, true, 'solo');
        } else if (m.to === me && m.tp === 'ok_solo' && st === 'search') {
          st = 'call';
          soloPid = m.f;
          clearInterval(sInt);
          goScr('call');
          chatOn(true);
          $('msgs').innerHTML = '';
          log('Собеседник найден! Вы в комнате 1 на 1 👋');
          createRtcWith(soloPid, false, 'solo');
        } else if (m.tp === 'seek_group' && st === 'group' && !groupMembers[m.f] && Object.keys(groupMembers).length < 6) {
          groupMembers[m.f] = m.name || 'Участник';
          renderGroupGrid();
          log(groupMembers[m.f] + ' присоединился!');
          if (me > m.f) createRtcWith(m.f, true, 'group');
        } else if (m.to === me) {
          if (m.tp === 'o') {
            if (m.callType === 'group' && st === 'group' && !groupMembers[m.f] && Object.keys(groupMembers).length < 6) {
              groupMembers[m.f] = m.name || 'Участник';
              renderGroupGrid();
              log(groupMembers[m.f] + ' присоединился!');
            }
            await createRtcWith(m.f, false, m.callType);
            const pc = peers[m.f];
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(m.o));
              const a = await pc.createAnswer();
              await pc.setLocalDescription(a);
              sendSig({ to: m.f, tp: 'a', a });
            }
          } else if (m.tp === 'a' && peers[m.f]) {
            await peers[m.f].setRemoteDescription(new RTCSessionDescription(m.a));
          } else if (m.tp === 'c' && peers[m.f]) {
            try { await peers[m.f].addIceCandidate(new RTCIceCandidate(m.c)); } catch (e) {}
          } else if (m.tp === 'txt' && m.f === soloPid) {
            log(m.v, 'he');
          } else if (m.tp === 'g_txt' && st === 'group' && groupMembers[m.f]) {
            log((m.name || 'Участник') + ': ' + m.v, 'he');
          } else if (m.tp === 'bye' && m.f === soloPid) {
            clickStop(true);
            $('hTitle').textContent = 'Собеседник отключился';
} else if (m.tp === 'g_bye' && st === 'group' && groupMembers[m.f]) {
log(groupMembers[m.f] + ' покинул комнату');
delete groupMembers[m.f];
closePeer(m.f);
renderGroupGrid();
}
}
}
}
} catch (e) {}
setTimeout(poll, 1000);
}
poll();
