var uiMode = 'solo';
var uiMuted = false;
var uiTimer = null;
var uiSec = 0;

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var myName = 'Участник #' + Math.floor(100 + Math.random() * 899);
var state = 'idle';
var partnerId = null;
var localStream = null;
var searchLoop = null;
var peers = {};
var lobby = {};
var group = {};
var seen = {};
var RELAY = 'https://ntfy.sh';

if (localStorage.getItem('likodopt_cookie_ok') === '1') {
  var cb = document.getElementById('cookieBanner');
  if (cb) cb.style.display = 'none';
}

function uiCloseCookie() {
  localStorage.setItem('likodopt_cookie_ok', '1');
  var cb = document.getElementById('cookieBanner');
  if (cb) cb.style.display = 'none';
}

function uiShowView(id) {
  clearInterval(uiTimer);
  uiSec = 0;
  ['idleView', 'queueView', 'callView', 'groupView'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.classList.remove('active');
  });
  var target = document.getElementById(id);
  if (target) target.classList.add('active');

  if (id !== 'idleView') {
    var tId = id === 'queueView' ? 'searchTimerText' : (id === 'callView' ? 'callTimerText' : 'groupTimerText');
    var tEl = document.getElementById(tId);
    if (tEl) tEl.textContent = '00:00';
    uiTimer = setInterval(function() {
      uiSec++;
      var m = String(Math.floor(uiSec / 60)).padStart(2, '0');
      var s = String(uiSec % 60).padStart(2, '0');
      if (tEl) tEl.textContent = m + ':' + s;
    }, 1000);
  }
}

function logMsg(txt, cls) {
  var box = document.getElementById('messages');
  if (!box) return;
  var d = document.createElement('div');
  d.className = 'msg ' + (cls || 'sys');
  d.textContent = txt;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function drawLobby() {
  var box = document.getElementById('lobbyChips');
  if (!box) return;
  box.innerHTML = '';
  var now = Date.now();
  Object.keys(lobby).forEach(function(u) {
    if (u !== myId && now - lobby[u].ts > 9000) delete lobby[u];
  });
  Object.keys(lobby).forEach(function(u) {
    var c = document.createElement('div');
    c.className = 'chip';
    c.textContent = u === myId ? '🟢 Вы (' + myName + ')' : '⏳ ' + lobby[u].name;
    box.appendChild(c);
  });
}

function drawGroup() {
  var grid = document.getElementById('groupGrid');
  if (!grid) return;
  grid.innerHTML = '';
  var ids = Object.keys(group);
  var cnt = document.getElementById('groupCountText');
  if (cnt) cnt.textContent = String(ids.length);
  for (var i = 0; i < 6; i++) {
    var s = document.createElement('div');
    if (ids[i]) {
      var isMe = ids[i] === myId;
      s.className = 'seat occupied';
      s.innerHTML = '<span style="font-size:1.3rem">' + (isMe ? '🎙️' : '🎧') + '</span><span>' + (isMe ? 'Вы' : group[ids[i]]) + '</span>';
    } else {
      s.className = 'seat';
      s.innerHTML = '<span style="font-size:1.3rem">➕</span><span>Свободно</span>';
    }
    grid.appendChild(s);
  }
}

function uiSwitchMode(m) {
  uiStopSession(false);
  uiMode = m;
  document.getElementById('btnModeSolo').classList.toggle('active', m === 'solo');
  document.getElementById('btnModeGroup').classList.toggle('active', m === 'group');
  document.getElementById('idleIcon').textContent = m === 'solo' ? '🎙️' : '👥';
  document.getElementById('status').textContent = m === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6 чел.)';
  uiShowView('idleView');
}

function initMic() {
  if (localStream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logMsg('Микрофон недоступен — работает чат');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function(s) {
      localStream = s;
      if (uiMuted) localStream.getAudioTracks().forEach(function(t) { t.enabled = false; });
      Object.keys(peers).forEach(function(u) {
        localStream.getTracks().forEach(function(t) { peers[u].addTrack(t, localStream); });
      });
    })
    .catch(function() {
      logMsg('Доступ к микрофону запрещён — работает чат');
    });
}

function closePeer(u) {
  if (peers[u]) {
    try { peers[u].close(); } catch (e) {}
    delete peers[u];
  }
  var a = document.getElementById('aud_' + u);
  if (a) a.remove();
}

function sendSig(data) {
  data.uco = myId;
  data.name = myName;
  data.nonce = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  data.ts = Date.now();
  try {
    fetch(RELAY, { method: 'POST', body: JSON.stringify(data) }).catch(function() {});
  } catch (e) {}
}

function uiStartSearch() {
  uiStopSession(false);
  document.getElementById('btnStop').disabled = false;
  document.getElementById('messages').innerHTML = '';
  initMic();

  if (uiMode === 'solo') {
    state = 'search';
    lobby[myId] = { name: myName, ts: Date.now() };
    drawLobby();
    uiShowView('queueView');
    logMsg('Вы в комнате ожидания собеседника...');
    sendSig({ cmd: 'wait_solo', to: '*' });
    searchLoop = setInterval(function() {
      if (state === 'search') {
        lobby[myId].ts = Date.now();
        drawLobby();
        sendSig({ cmd: 'wait_solo', to: '*' });
      }
    }, 1500);
  } else {
    state = 'group';
    group[myId] = myName;
    drawGroup();
    uiShowView('groupView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
    logMsg('Вы вошли в групповую комнату (до 6 мест)');
    sendSig({ cmd: 'wait_group', to: '*' });
    searchLoop = setInterval(function() {
      if (state === 'group' && Object.keys(group).length < 6) {
        sendSig({ cmd: 'wait_group', to: '*' });
      }
    }, 2000);
  }
}

function uiStopSession(toHome) {
  clearInterval(uiTimer);
  clearInterval(searchLoop);
  if (partnerId) sendSig({ cmd: 'bye', to: partnerId, kind: 'solo' });
  if (state === 'group') {
    Object.keys(group).forEach(function(u) {
      if (u !== myId) sendSig({ cmd: 'bye', to: u, kind: 'group' });
    });
  }
  Object.keys(peers).forEach(closePeer);
  group = {};
  lobby = {};
  partnerId = null;
  state = 'idle';
  document.getElementById('msgInput').disabled = true;
  document.getElementById('btnSend').disabled = true;
  if (toHome) {
    document.getElementById('btnStop').disabled = true;
    document.getElementById('status').textContent = 'Поиск остановлен';
    uiShowView('idleView');
    logMsg('Вы вышли на главный экран');
  }
}

function uiToggleMute() {
  uiMuted = !uiMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !uiMuted; });
  }
  var btn = document.getElementById('btnMute');
  btn.textContent = uiMuted ? 'Включить микрофон' : 'Выключить микрофон';
  btn.classList.toggle('muted', uiMuted);
  logMsg(uiMuted ? 'Микрофон выключен' : 'Микрофон включён');
}

function uiSendChat(e) {
  e.preventDefault();
  var inp = document.getElementById('msgInput');
  var txt = inp.value.trim();
  if (!txt) return;
  if (state === 'call' && partnerId) {
    logMsg(txt, 'me');
    sendSig({ cmd: 'comm', to: partnerId, kind: 'solo', data: txt });
    inp.value = '';
  } else if (state === 'group') {
    logMsg(txt, 'me');
    Object.keys(group).forEach(function(u) {
      if (u !== myId) sendSig({ cmd: 'comm', to: u, kind: 'group', data: txt });
    });
    inp.value = '';
  }
}

async function startRtc(to, init, kind) {
  closePeer(to);
  var pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:://google.com' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  });
  peers[to] = pc;
  if (localStream) {
    localStream.getTracks().forEach(function(t) { pc.addTrack(t, localStream); });
  }
  pc.ontrack = function(e) {
    var a = document.getElementById('aud_' + to);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'aud_' + to;
      a.autoplay = true;
      a.playsInline = true;
      var pool = document.getElementById('audioPool');
      if (pool) pool.appendChild(a);
    }
    a.srcObject = new MediaStream([e.track]);
    a.play().catch(function() {});
  };
  pc.onicecandidate = function(e) {
    if (e.candidate) sendSig({ cmd: 'ice', to: to, data: e.candidate });
  };
  if (init) {
    var off = await pc.createOffer();
    await pc.setLocalDescription(off);
    sendSig({ cmd: 'offer', to: to, data: off, kind: kind });
  }
}

async function onPacket(pkt) {
  if (pkt.cmd === 'wait_solo' && state === 'search') {
    lobby[pkt.uco] = { name: pkt.name, ts: Date.now() };
    drawLobby();
    if (myId > pkt.uco) {
      state = 'call';
      partnerId = pkt.uco;
      clearInterval(searchLoop);
      sendSig({ cmd: 'pair', to: partnerId, kind: 'solo' });
      uiShowView('callView');
      document.getElementById('msgInput').disabled = false;
      document.getElementById('btnSend').disabled = false;
      document.getElementById('messages').innerHTML = '';
      logMsg('Собеседник найден! Поздоровайтесь 👋');
      startRtc(partnerId, true, 'solo');
    }
  } else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'solo' && state === 'search') {
    state = 'call';
    partnerId = pkt.uco;
    clearInterval(searchLoop);
    uiShowView('callView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
    document.getElementById('messages').innerHTML = '';
    logMsg('Собеседник найден! Поздоровайтесь 👋');
    startRtc(partnerId, false, 'solo');
  } else if (pkt.cmd === 'wait_group' && state === 'group' && !group[pkt.uco] && Object.keys(group).length < 6) {
    group[pkt.uco] = pkt.name;
    drawGroup();
    logMsg(pkt.name + ' зашёл в комнату');
    sendSig({ cmd: 'pair', to: pkt.uco, kind: 'group' });
    if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
} else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'group' && state === 'group' && !group[pkt.uco] && Object.keys(group).длина < 6) {
группа[pkt.uco] = pkt.name ;
drawGroup();
if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
} else if (pkt.to === myId) {
if (pkt.cmd === 'предложение') {
if (pkt.kind === 'группа' && state === 'группа' && !group[pkt.uco] && Object.keys(группа).длина < 6) {
группа[pkt.uco] = pkt.name ;
drawGroup();
}
ожидает startRtc(pkt.uco, false, pkt.kind);
ожидает одноранговые узлы[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
var ans = ожидает одноранговые узлы[pkt.uco].createAnswer();
ожидает одноранговые узлы[pkt.uco].setLocalDescription(ans);
Отправляет ({ cmd: 'answer', кому: pkt. uco, данные: ans });
} else if (pkt.cmd === 'answer' && peers[pkt.uco]) {
ожидают peers[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
} else if (pkt.cmd === 'ice' && peers[pkt.uco]) {
try { await peers[pkt.uco].addIceCandidate(новый RTCIceCandidate(pkt.data)); } catch (e) {}
} else if (pkt.cmd === 'comm') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) logMsg(pkt.data, 'partner');
if (pkt.kind === 'group' && state === 'group' && group[ пкт.uco]) logMsg(pkt.name + ': ' + пкт.данные, 'partner');
} else if (pkt.cmd === 'bye') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) {
uiStopSession(true);
document.getElementById('status').textContent = 'Собеседник отключился';
}
if (pkt.kind === 'group' && state === 'group' && group[pkt.uco]) {
logMsg(group[pkt.uco] + ' вышел');
delete group[pkt.uco];
closePeer(pkt.uco);
drawGroup();
}
}
}
}
асинхронная функция poll() {
try {
var res = await fetch(RELAY + '/json?poll=1&since=12s');
if (res.ok) {
var lines = (await res.text()).trim().split('\n');
for (var i = 0; i < lines.длина; i++) {
if (!строки[i]) продолжить;
var w = JSON.parse(строки[i]);
if (!без сообщения) продолжить;
var pkt = JSON.parse(без сообщения);
if (!pkt || pkt.uco === myId || видел [pkt.одноразовый номер] || Date.now() - pkt.ts > 16000) продолжить;
видел[pkt.одноразовый номер] = true;
onPacket(pkt );
}
}
} catch (e) {}
setTimeout(опрос, 1000);
}
опрос ();
