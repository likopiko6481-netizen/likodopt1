---

### 2. Файл `net.js` (вся логика кнопок, аватарок, таймера, чата и звука WebRTC)
Скопируй и вставь в `net.js`:

```javascript
var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle', partnerId = null, loop = null, timerInt = null, lastId = 0;
var currentMode = 'solo';
var isMuted = false;
var lobby = {}, group = {}, seen = {};
var connections = {}, iceQueue = {};
window.localStream = null;

var rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Генератор пиксельных аватарок
function makePixelAva() {
  var c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  var ctx = c.getContext('2d');
  var colors = ['#00e676', '#00b0ff', '#ff4081', '#ffd740', '#7c4dff', '#ff6e40'];
  var col = colors[Math.floor(Math.random() * colors.length)];
  ctx.fillStyle = '#181c24';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = col;
  for (var y = 1; y < 7; y++) {
    for (var x = 1; x < 4; x++) {
      if (Math.random() > 0.45) {
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(7 - x, y, 1, 1);
      }
    }
  }
  return c.toDataURL();
}

window.myAvaUrl = localStorage.getItem('liko_ava') || makePixelAva();
localStorage.setItem('liko_ava', window.myAvaUrl);

var avaImg = document.getElementById('myAvaImg');
if (avaImg) avaImg.src = window.myAvaUrl;

var nickInp = document.getElementById('nickInput');
if (nickInp) {
  nickInp.value = localStorage.getItem('liko_nick') || '';
  nickInp.oninput = function() {
    localStorage.setItem('liko_nick', nickInp.value.trim());
  };
}

function rerollAva() {
  window.myAvaUrl = makePixelAva();
  localStorage.setItem('liko_ava', window.myAvaUrl);
  if (avaImg) avaImg.src = window.myAvaUrl;
}
if (avaImg) avaImg.onclick = rerollAva;
var btnReroll = document.getElementById('btnRerollAva');
if (btnReroll) btnReroll.onclick = rerollAva;

function nick() {
  var val = nickInp ? nickInp.value.trim() : '';
  return val || 'Гость #' + myId.slice(-3);
}
function ava() { return window.myAvaUrl || ''; }

// Cookie баннер
var cBanner = document.getElementById('cookieBanner');
if (cBanner && !localStorage.getItem('liko_cookie_ok')) {
  cBanner.classList.add('show');
}
var btnCloseCookie = document.getElementById('btnCloseCookie');
if (btnCloseCookie) {
  btnCloseCookie.onclick = function() {
    localStorage.setItem('liko_cookie_ok', '1');
    if (cBanner) cBanner.classList.remove('show');
  };
}

window.showScr = function(id) {
  ['idleView', 'queueView', 'callView', 'groupView'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.classList.toggle('active', s === id);
  });
};

// Таймер поиска
function startTimer() {
  clearInterval(timerInt);
  var sec = 0;
  var el = document.getElementById('searchTimerText');
  if (el) el.textContent = '00:00';
  timerInt = setInterval(function() {
    sec++;
    var m = String(Math.floor(sec / 60)).padStart(2, '0');
    var s = String(sec % 60).padStart(2, '0');
    if (el) el.textContent = m + ':' + s;
  }, 1000);
}

// Инициализация микрофона
async function initAudio() {
  if (window.localStream) return window.localStream;
  try {
    window.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    window.localStream.getAudioTracks().forEach(function(t) { t.enabled = !isMuted; });
    return window.localStream;
  } catch (e) {
    log('⚠️ Микрофон недоступен (работает текстовый чат)');
    return null;
  }
}

// WebRTC соединение
async function getPeer(remoteId, sendFn) {
  if (connections[remoteId]) return connections[remoteId];
  var pc = new RTCPeerConnection(rtcConfig);
  connections[remoteId] = pc;

  if (window.localStream) {
    window.localStream.getTracks().forEach(function(track) {
      pc.addTrack(track, window.localStream);
    });
  }

  pc.onicecandidate = function(event) {
    if (event.candidate) {
      sendFn({ ev: 'ice', to: remoteId, cand: event.candidate });
    }
  };

  pc.ontrack = function(event) {
    var pool = document.getElementById('audioPool');
    var audio = document.getElementById('audio_' + remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'audio_' + remoteId;
      audio.autoplay = true;
      audio.playsInline = true;
      if (pool) pool.appendChild(audio);
    }
    audio.srcObject = event.streams;
  };

  return pc;
}

window.saveOrAddIce = async function(remoteId, cand) {
  var pc = connections[remoteId];
  if (pc && pc.remoteDescription) {
    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
  } else {
    if (!iceQueue[remoteId]) iceQueue[remoteId] = [];
    iceQueue[remoteId].push(cand);
  }
};

window.flushIce = async function(remoteId) {
  var pc = connections[remoteId];
  if (!pc || !iceQueue[remoteId]) return;
  while (iceQueue[remoteId].length > 0) {
    var c = iceQueue[remoteId].shift();
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
  }
};

function closePeer(remoteId) {
  if (connections[remoteId]) {
    connections[remoteId].close();
    delete connections[remoteId];
  }
  delete iceQueue[remoteId];
  var audio = document.getElementById('audio_' + remoteId);
  if (audio) audio.remove();
}

function send(pkt) {
  pkt.from = myId;
  pkt.nick = nick();
  pkt.ava = ava();
  pkt.id = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  pkt.ts = Date.now();

  fetch('/api/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pkt)
  }).catch(function() {});
}

async function poll() {
  var st = document.getElementById('netStatus');
  var dot = document.getElementById('connDot');
  try {
    var r = await fetch('/api/poll?lastId=' + lastId + '&uid=' + myId);
    if (r.ok) {
      var data = await r.json();
      if (st) st.textContent = 'Онлайн • Сервер РФ';
      if (dot) dot.classList.add('connected');
      var cnt = document.getElementById('onlineCount');
      if (cnt && data.online) cnt.textContent = data.online;
      if (data.rows) {
        for (var i = 0; i < data.rows.length; i++) {
          if (data.rows[i].id > lastId) lastId = data.rows[i].id;
          onSignal(data.rows[i].payload);
        }
      }
    }
  } catch (e) {
    if (st) st.textContent = 'Переподключение...';
    if (dot) dot.classList.remove('connected');
  }
  setTimeout(poll, 700);
}

fetch('/api/poll?lastId=0&uid=' + myId)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d && d.lastId) lastId = d.lastId;
    poll();
  })
  .catch(function() { poll(); });

function log(txt, cls, n) {
  var box = document.getElementById('messages');
  if (!box) return;
  var d = document.createElement('div');
  d.className = 'msg ' + (cls || 'sys');
  d.textContent = (n ? n + ': ' : '') + txt;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function drawLobby() {
  var box = document.getElementById('lobbyChips');
  if (!box) return;
  box.innerHTML = '';
  Object.keys(lobby).forEach(function(u) {
    var c = document.createElement('div');
    c.className = 'chip';
    c.textContent = u === myId ? '🟢 ' + nick() + ' (Вы)' : '⏳ ' + lobby[u];
    box.appendChild(c);
  });
}

function drawGroup() {
  var grid = document.getElementById('groupGrid');
  if (!grid) return;
  grid.innerHTML = '';
  var ids = Object.keys(group);
  var cnt = document.getElementById('groupCountText');
  if (cnt) cnt.textContent = ids.length;
  for (var i = 0; i < 6; i++) {
    var s = document.createElement('div');
    if (ids[i]) {
      var isMe = ids[i] === myId;
      var uAva = isMe ? ava() : group[ids[i]].ava;
      var uName = isMe ? nick() : group[ids[i]].nick;
      s.className = 'seat occupied';
      s.innerHTML = (uAva ? '<img src="' + uAva + '" style="width:26px;height:26px;border-radius:5px;image-rendering:pixelated;border:1px solid #00e676;">' : '<span>🎙️</span>') + '<span>' + uName + '</span>';
    } else {
      s.className = 'seat';
      s.innerHTML = '<span>➕</span><span>Свободно</span>';
    }
    grid.appendChild(s);
  }
}

function openSoloRoom(pName, pAva) {
  clearInterval(timerInt);
  window.showScr('callView');
  document.getElementById('msgInput').disabled = false;
  document.getElementById('btnSend').disabled = false;
  document.getElementById('messages').innerHTML = '';
  var mAva = ava();
  document.getElementById('roomMeCard').innerHTML = (mAva ? '<img src="' + mAva + '" style="width:36px;height:36px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;">' : '<span>🎙️</span>') + '<span>' + nick() + ' (Вы)</span>';
  document.getElementById('roomPartnerCard').innerHTML = (pAva ? '<img src="' + pAva + '" style="width:36px;height:36px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;">' : '<span>🎧</span>') + '<span>' + pName + '</span>';
  log('Вы в руме с ' + pName + ' 👋');
}

window.netStartSearch = async function(mode) {
  window.netStopSession();
  await initAudio();
  document.getElementById('btnStop').disabled = false;

  if (mode === 'solo') {
    netState = 'search';
    window.showScr('queueView');
    startTimer();
    lobby[myId] = nick();
    drawLobby();
    log('Поиск собеседника...');
    send({ ev: 'w1' });
    loop = setInterval(function() { if (netState === 'search') send({ ev: 'w1' }); }, 1200);
  } else {
    netState = 'group';
    window.showScr('groupView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
    group[myId] = { nick: nick(), ava: ava() };
    drawGroup();
    log('Вы вошли в групповую руму');
    send({ ev: 'w6' });
    loop = setInterval(function() { if (netState === 'group' && Object.keys(group).length < 6) send({ ev: 'w6' }); }, 1800);
  }
};

window.netStopSession = function() {
  clearInterval(loop);
  clearInterval(timerInt);
  if (partnerId) send({ ev: 'bye', to: partnerId });
if (netState === 'group') send({ ev: 'bye_group' });
Object.keys(connections).forEach(closePeer);
lobby = {};
group = {};
partnerId = null;
netState = 'idle';
window.showScr('idleView');
document.getElementById('msgInput').disabled = true;
document.getElementById('btnSend').disabled = true;
document.getElementById('btnStop').disabled = true;
};
window.netSendChat = function(txt) {
log(txt, 'me', nick());
if (netState === 'call' && partnerId) send({ ev: 'msg', to: partnerId, txt: txt });
if (netState === 'group') {
Object.keys(group).forEach(function(u) { if (u !== myId) send({ ev: 'msg', to: u, txt: txt }); });
}
};
async function onSignal(p) {
if (!p || p.from === myId || seen[p.id] || (p.ts && Date.now() - p.ts > 25000)) return;
seen[p.id] = 1;
если (p.ev === «w1» и netState === «поиск») {
lobby[p.from] = p.nick;
drawLobby();
if (myId > p.from) {
netState = 'вызов';
partnerId = p.from;
clearInterval(цикл);
отправить({ ev: 'p1', кому: partnerId });
openSoloRoom(p.nick, p.ava);
var pc = ожидать getPeer(partnerId, отправить);
var off = ожидать pc.createOffer();
ожидать pc.setLocalDescription(выкл.);
отправить({ ev: 'выкл.', кому: partnerId, выкл.: выкл. });
}
} else if (стр.ev === 'p1' && p.to === myId && netState === 'поиск') {
netState = 'вызов';
partnerId = p.from;
clearInterval(цикл);
openSoloRoom(p.ник, p.ава);
} else if (p.ev === 'w6' && netState === 'group' && !group[p.from] && Object.keys(группа).длина < 6) {
group[p.from] = { ник: p.nick, ава: p.ava };
drawGroup();
отправить({ ev: 'w6' });
if (myId > p.from) {
var pc6 = ожидать получения (p.from, отправить);
var off6 = ожидать pc6.createOffer();
ожидать pc6.setLocalDescription(off6);
отправить({ ev: 'off', кому: p.from, off: off6 });
}
} else if (p.ev === 'bye_group' && netState === 'group' && group[p.from]) {
удалить группу[p.from];
closePeer(p.from);
drawGroup();
} else if (p.to === myId) {
if (p.ev === 'выкл.') {
var pcIn = ожидает getPeer(p.from, отправить);
ожидает pcIn.setRemoteDescription(новое RTCSessionDescription(p.выкл.));
ожидает окно.Флушице(стр.from);
var ans = await pcIn.createAnswer();
await pcIn.setLocalDescription(ans);
send({ ev: 'ans', to: p.from, ans: ans });
} else if (p.ev === 'ans' && connections[p.from]) {
await connections[p.from].setRemoteDescription(new RTCSessionDescription(p.ans));
await window.flushIce(p.from);
} else if (p.ev === 'ice') {
await window.saveOrAddIce(p.from, p.cand);
} else if (p.ev === 'msg') {
log(p.txt, 'partner', p.nick);
} else if (p.ev === 'bye') {
log('Собеседник отключился');
window.netStopSession();
}
}
}
document.getElementById('modeSolo').onclick = function() {
currentMode = 'solo';
this.classList.add('active');
document.getElementById('modeGroup').classList.remove('active');
window.netStopSession();
};
document.getElementById('modeGroup').onclick = function() {
currentMode = 'group';
this.classList.add('активный');
document.getElementById('modeSolo').classList.remove('активный');
window.netStopSession();
};
document.getElementById('btnNext').onclick = функция() {
window.netStartSearch(текущий режим);
};
document.getElementById('btnStop').onclick = функция() {
window.netStopSession();
журнал('Поиск остановлен');
};
document.getElementById('btnMute').onclick = функция() {
isMuted = !isMuted;
если (window.localStream) {
window.localStream.getAudioTracks().forEach(function(t) { t.enabled = !isMuted; });
}
this.textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
this.classList.toggle('muted', isMuted);
log(isMuted ? '🔇 Микрофон выключен' : '🎙️ Микрофон включен');
};
document.getElementById('chatForm').onsubmit = function(e) {
e.preventDefault();
var inp = document.getElementById('msgInput');
var txt = inp.value.trim();
if (!txt) return;
inp.value = '';
window.netSendChat(txt);
};
