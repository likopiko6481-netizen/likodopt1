var $ = function(id) { return document.getElementById(id); };
var me = 'u_' + Math.random().toString(36).slice(2, 9);
var myName = 'Участник #' + Math.floor(100 + Math.random() * 899);

var mode = 'solo';
var state = 'home';
var soloPid = null;
var mic = null;
var muted = false;
var timer = null;
var searchLoop = null;
var sec = 0;

var peers = {};
var lobby = {};
var grp = {};
var seen = {};

// 1. Закрытие Cookie
if (localStorage.getItem('lk_ck') === '1') $('ckBox').style.display = 'none';
$('ckClose').onclick = function() {
  localStorage.setItem('lk_ck', '1');
  $('ckBox').style.display = 'none';
};

// 2. Переключение экранов
function show(id) {
  ['sHome', 'sWait', 'sCall', 'sGroup'].forEach(function(s) { $(s).classList.remove('on'); });
  $(id).classList.add('on');
}

function addLog(text, cls) {
  var d = document.createElement('div');
  d.className = 'm ' + (cls || 'sys');
  d.textContent = text;
  var box = $('msgs');
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function drawLobby() {
  var box = $('lobbyList');
  box.innerHTML = '';
  var now = Date.now();
  Object.keys(lobby).forEach(function(u) {
    if (u !== me && now - lobby[u].ts > 8000) delete lobby[u];
  });
  Object.keys(lobby).forEach(function(u) {
    var c = document.createElement('div');
    c.className = 'chip';
    c.textContent = u === me ? '🟢 Вы' : '⏳ ' + lobby[u].name;
    box.appendChild(c);
  });
}

function drawGroup() {
  var g = $('gGrid');
  g.innerHTML = '';
  var ids = Object.keys(grp);
  for (var i = 0; i < 6; i++) {
    var s = document.createElement('div');
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

// 3. Переключение режимов Соло / Группа
function switchMode(m) {
  stopWait(false);
  mode = m;
  $('mSolo').classList.toggle('on', m === 'solo');
  $('mGroup').classList.toggle('on', m === 'group');
  $('hIco').textContent = m === 'solo' ? '🎙️' : '👥';
  $('hTitle').textContent = m === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6)';
}

$('mSolo').onclick = function() { switchMode('solo'); };
$('mGroup').onclick = function() { switchMode('group'); };

// 4. Кнопка «Найти / Далее»
$('bNext').onclick = function() {
  stopWait(false);
  sec = 0;
  $('bStop').disabled = false;
  $('msgs').innerHTML = '';

  if (!mic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(s) {
      mic = s;
      if (muted) mic.getAudioTracks().forEach(function(t) { t.enabled = false; });
    }).catch(function() { addLog('Микрофон недоступен — работает чат'); });
  }

  if (mode === 'solo') {
    state = 'wait';
    lobby[me] = { name: myName, ts: Date.now() };
    drawLobby();
    show('sWait');
    $('tWait').textContent = 'Время ожидания: 00:00';
    addLog('Вы в комнате ожидания (1 на 1)...');
    sendSig({ cmd: 'wait_solo' });
    searchLoop = setInterval(function() {
      if (state === 'wait') {
        lobby[me].ts = Date.now();
        drawLobby();
        sendSig({ cmd: 'wait_solo' });
      }
    }, 1500);
  } else {
    state = 'group';
    grp[me] = myName;
    drawGroup();
    show('sGroup');
    $('inp').disabled = false;
    $('bSend').disabled = false;
    $('tGroup').textContent = '● Комната (1/6) • 00:00';
    addLog('Вы вошли в групповую комнату (до 6 чел.)');
    sendSig({ cmd: 'wait_group' });
    searchLoop = setInterval(function() {
      if (state === 'group' && Object.keys(grp).length < 6) sendSig({ cmd: 'wait_group' });
    }, 2000);
  }

  timer = setInterval(function() {
    sec++;
    var t = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    if (state === 'wait') $('tWait').textContent = 'Время ожидания: ' + t;
    if (state === 'call') $('tCall').textContent = '● Разговор: ' + t;
    if (state === 'group') $('tGroup').textContent = '● Комната (' + Object.keys(grp).length + '/6) • ' + t;
  }, 1000);
};

// 5. Кнопка «Стоп»
function stopWait(showStopped) {
  clearInterval(timer);
  clearInterval(searchLoop);
  if (soloPid) sendSig({ to: soloPid, cmd: 'bye' });
  if (state === 'group') {
    Object.keys(grp).forEach(function(u) { if (u !== me) sendSig({ to: u, cmd: 'bye6' }); });
  }
  Object.keys(peers).forEach(function(u) {
    try { peers[u].close(); } catch (e) {}
    delete peers[u];
    var a = $('a_' + u);
    if (a) a.remove();
  });
  grp = {};
  lobby = {};
  soloPid = null;
  state = 'home';
  $('inp').disabled = true;
  $('bSend').disabled = true;

  if (showStopped) {
    $('bStop').disabled = true;
    show('sHome');
    $('hTitle').textContent = 'Поиск остановлен';
    addLog('Вы вышли из комнаты');
  }
}

$('bStop').onclick = function() { stopWait(true); };

// 6. Кнопка «Выключить микрофон»
$('bMute').onclick = function() {
  muted = !muted;
  if (mic) mic.getAudioTracks().forEach(function(t) { t.enabled = !muted; });
  this.textContent = muted ? 'Включить микрофон' : 'Выключить микрофон';
  this.classList.toggle('on', muted);
};

// 7. Чат
$('cForm').onsubmit = function(e) {
  e.preventDefault();
  var txt = $('inp').value.trim();
  if (!txt) return;
  if (state === 'call' && soloPid) {
    addLog(txt, 'me');
    sendSig({ to: soloPid, cmd: 'comm', v: txt });
    $('inp').value = '';
  } else if (state === 'group') {
    addLog(txt, 'me');
    Object.keys(grp).forEach(function(u) { if (u !== me) sendSig({ to: u, cmd: 'comm6', v: txt }); });
    $('inp').value = '';
  }
};

// 8. Протокол подключения собеседников (WebSocket + WebRTC)
var ws = null;
function initNet() {
  try {
    ws = new WebSocket('wss://://socketsbay.com');
    ws.onopen = function() { $('netSt').textContent = '● Онлайн: В сети'; };
    ws.onmessage = function(e) {
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || m.app !== 'likodopt_v3' || m.uco === me || seen[m.nonce]) return;
      seen[m.nonce] = true;
      handlePacket(m);
    };
    ws.onclose = function() { setTimeout(initNet, 2000); };
  } catch (e) {}
}
initNet();

function sendSig(data) {
  if (!ws || ws.readyState !== 1) return;
  data.app = 'likodopt_v3';
  data.uco = me;
  data.name = myName;
  data.nonce = me + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  try { ws.send(JSON.stringify(data)); } catch (e) {}
}

async function startRtc(to, init, kind) {
  if (peers[to]) { try { peers[to].close(); } catch (e) {} }
  var pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:://google.com' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  });
  peers[to] = pc;
  if (mic) mic.getTracks().forEach(function(t) { pc.addTrack(t, mic); });
  pc.ontrack = function(e) {
    var a = $('a_' + to);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'a_' + to;
      a.autoplay = true;
      $('auds').appendChild(a);
    }
    a.srcObject = new MediaStream([e.track]);
    a.play().catch(function() {});
  };
  pc.onicecandidate = function(e) {
    if (e.candidate) sendSig({ to: to, cmd: 'ice', c: e.candidate });
  };
  if (init) {
    var o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sendSig({ to: to, cmd: 'offer', o: o, kind: kind });
  }
}

async function handlePacket(m) {
  if (m.cmd === 'wait_solo' && state === 'wait') {
    lobby[m.uco] = { name: m.name, ts: Date.now() };
    drawLobby();
    if (me > m.uco) {
      state = 'call';
      soloPid = m.uco;
      clearInterval(searchLoop);
      sec = 0;
      sendSig({ to: soloPid, cmd: 'pair' });
      show('sCall');
      $('inp').disabled = false;
      $('bSend').disabled = false;
      $('msgs').innerHTML = '';
      addLog('Собеседник найден! 👋');
      startRtc(soloPid, true, 'solo');
    }
  } else if (m.to === me && m.cmd === 'pair' && state === 'wait') {
    state = 'call';
    soloPid = m.uco;
    clearInterval(searchLoop);
    sec = 0;
    show('sCall');
    $('inp').disabled = false;
    $('bSend').disabled = false;
    $('msgs').innerHTML = '';
    addLog('Собеседник найден! 👋');
    startRtc(soloPid, false, 'solo');
  } else if (m.cmd === 'wait_group' && state === 'group' && !grp[m.uco] && Object.keys(grp).length < 6) {
    grp[m.uco] = m.name;
    drawGroup();
    addLog(m.name + ' зашёл в комнату');
    sendSig({ to: m.uco, cmd: 'pair6' });
    if (me > m.uco) startRtc(m.uco, true, 'group');
  } else if (m.to === me && m.cmd === 'pair6' && state === 'group' && !grp[m.uco] && Object.keys(grp).length < 6) {
    grp[m.uco] = m.name;
    drawGroup();
    if (me > m.uco) startRtc(m.uco, true, 'group');
  } else if (m.to === me) {
    if (m.cmd === 'offer') {
      if (m.kind === 'group' && state === 'group' && !grp[m.uco] && Object.keys(grp).length < 6) {
        grp[m.uco] = m.name;
        drawGroup();
      }
      await startRtc(m.uco, false, m.kind);
      await peers[m.uco].setRemoteDescription(new RTCSessionDescription(m.o));
      var a = await peers[m.uco].createAnswer();
      await peers[m.uco].setLocalDescription(a);
      sendSig({ to: m.uco, cmd: 'answer', a: a });
    } else if (m.cmd === 'answer' && peers[m.uco]) {
      await peers[m.uco].setRemoteDescription(new RTCSessionDescription(m.a));
    } else if (m.cmd === 'ice' && peers[m.uco]) {
      try { await peers[m.uco].addIceCandidate(new RTCIceCandidate(m.c)); } catch (e) {}
    } else if (m.cmd === 'comm' && m.uco === soloPid) {
      addLog(m.v, 'he');
    } else if (m.cmd === 'comm6' && state === 'group' && grp[m.uco]) {
      addLog(m.name + ': ' + m.v, 'he');
    } else if (m.cmd === 'bye' && m.uco === soloPid) {
      stopWait(true);
      $('hTitle').textContent = 'Собеседник отключился';
    } else if (m.cmd === 'bye6' && state === 'group' && grp[m.uco]) {
addLog(grp[m.uco_] + ' вышел');
удалить grp[m.uco_];
if (peers[m.uco_]) peers[m.uco_].close();
удалить peers[m.uco_];
drawGroup();
}
}
}
