var SUPABASE_URL = 'https://supabase.co';
var SUPABASE_KEY = 'sb_publishable_6Y72t3-gkgmLmoRJGECLMQ_d1azrPSN';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle';
var currentRoomId = null;
var partnerId = null;
var localStream = null;
var searchLoop = null;
var lastRowId = 0;

// Хранилища соединений и участников по вашей архитектуре
var connections = {};
var participants = {};
var lobby = {};
var seenNonces = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' },
    { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' }
  ],
  iceCandidatePoolSize: 10
};

function getMyNick() { return window.myNick || 'Участник #' + myId.slice(-3); }
function getMyAva() { return window.myAvaUrl || ''; }

// =========================================================================
// 1. УНИВЕРСАЛЬНЫЙ ТРАНСПОРТНЫЙ СОКЕТ (ВКЛАДКИ ПК + ОБЛАКО SUPABASE)
// =========================================================================
var localBus = null;
try {
  localBus = new BroadcastChannel('likodopt_rtc_mesh');
  localBus.onmessage = function(e) {
    handleIncomingSocketEvent(e.data);
  };
} catch (e) {}

var socket = {
  id: myId,
  emit: function(eventName, payload) {
    var packet = Object.assign({
      event: eventName,
      from: myId,
      nick: getMyNick(),
      ava: getMyAva(),
      nonce: myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ts: Date.now()
    }, payload || {});

    if (localBus) {
      try { localBus.postMessage(packet); } catch (e) {}
    }

    fetch(SUPABASE_URL + '/rest/v1/room_signals', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ payload: packet })
    }).catch(function() {});
  }
};

async function pollCloudSignals() {
  try {
    var url = SUPABASE_URL + '/rest/v1/room_signals?select=id,payload&id=gt.' + lastRowId + '&order=id.asc&limit=50';
    var res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY } });
    var st = document.getElementById('netStatus');
    if (res.ok) {
      if (st) st.textContent = 'Онлайн: В сети';
      var rows = await res.json();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id > lastRowId) lastRowId = rows[i].id;
        handleIncomingSocketEvent(rows[i].payload);
      }
    }
  } catch (e) {}
  setTimeout(pollCloudSignals, 850);
}
pollCloudSignals();

// =========================================================================
// 2. АУДИОПОТОК (initAudio) И УПРАВЛЕНИЕ WEBRTC (getOrCreatePeerConnection)
// =========================================================================
function initAudio() {
  if (localStream) {
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return Promise.resolve(localStream);
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logMsg('Микрофон недоступен — работает текстовый чат');
    return Promise.resolve(null);
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  })
    .then(function(stream) {
      localStream = stream;
      localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      Object.keys(connections).forEach(function(uid) {
        var pc = connections[uid];
        if (pc && pc.getSenders().length === 0) {
          localStream.getTracks().forEach(function(track) { pc.addTrack(track, localStream); });
        }
      });
      return localStream;
    })
    .catch(function() {
      logMsg('Доступ к микрофону запрещён — работает чат');
      return null;
    });
}

function addRemoteAudioElement(userId, stream) {
  var a = document.getElementById('aud_' + userId);
  if (!a) {
    a = document.createElement('audio');
    a.id = 'aud_' + userId;
    a.autoplay = true;
    a.playsInline = true;
    var pool = document.getElementById('audioPool');
    if (pool) pool.appendChild(a);
  }
  a.srcObject = stream;
  a.play().catch(function() {});
}

function closePeerConnection(userId) {
  if (connections[userId]) {
    try { connections[userId].close(); } catch (e) {}
    delete connections[userId];
  }
  var a = document.getElementById('aud_' + userId);
  if (a) a.remove();
}

function getOrCreatePeerConnection(sock, userId) {
  if (connections[userId]) {
    return connections[userId];
  }

  var pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = function(event) {
    var remoteStream = (event.streams && event.streams) ? event.streams : new MediaStream([event.track]);
    addRemoteAudioElement(userId, remoteStream);
  };

  pc.onicecandidate = function(event) {
    if (event.candidate) {
      sock.emit('ice-candidate', {
        candidate: event.candidate,
        to: userId,
        roomId: currentRoomId
      });
    }
  };

  if (localStream && pc.getSenders().length === 0) {
    localStream.getTracks().forEach(function(track) {
      pc.addTrack(track, localStream);
    });
  }

  connections[userId] = pc;
  return pc;
}

// =========================================================================
// 3. ПОИСК СОБЕСЕДНИКА (findMatch) И ОБРАБОТКА СОВПАДЕНИЯ (handleMatchFound)
// =========================================================================
function findMatch(sock, mode) {
  var eventType = mode === 'group' ? 'find-group' : 'find-match';
  sock.emit(eventType, { mode: mode });
}

async function handleMatchFound(sock, data) {
  var users = data.users || [];
  currentRoomId = data.roomId || ('room_' + Date.now());

  if (!localStream) {
    await initAudio();
  }

  users.forEach(function(userId) {
    if (userId !== sock.id) {
      var pc = getOrCreatePeerConnection(sock, userId);
      pc.createOffer()
        .then(function(offer) { return pc.setLocalDescription(offer); })
        .then(function() {
          sock.emit('send-offer', {
            offer: pc.localDescription,
            to: userId,
            roomId: currentRoomId
          });
        })
        .catch(function(e) { console.error('Ошибка создания Offer:', e); });
    }
  });
}

// =========================================================================
// 4. ОБРАБОТКА ВХОДЯЩИХ OFFER, ANSWER И ICE-КАНДИДАТОВ
// =========================================================================
async function handleReceiveOffer(sock, data) {
  var fromId = data.from;
  if (!localStream) {
    await initAudio();
  }
  var pc = getOrCreatePeerConnection(sock, fromId);
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  var answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sock.emit('send-answer', {
    answer: pc.localDescription,
    to: fromId,
    roomId: data.roomId || currentRoomId
  });
}

async function handleReceiveAnswer(data) {
  var pc = connections[data.from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
}

async function handleIceCandidate(data) {
  var pc = connections[data.from];
  if (pc && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {}
  }
}

// =========================================================================
// 5. ДИСПЕТЧЕР СОБЫТИЙ И ОТРИСОВКА ИНТЕРФЕЙСА (РУМЫ, НИКИ, ЧАТ)
// =========================================================================
async function handleIncomingSocketEvent(pkt) {
  if (!pkt || !pkt.event || pkt.from === myId) return;
  if (pkt.nonce && seenNonces[pkt.nonce]) return;
  if (pkt.ts && Date.now() - pkt.ts > 30000) return;
  if (pkt.nonce) seenNonces[pkt.nonce] = true;

  // Входящий поиск 1 на 1
  if (pkt.event === 'find-match' && netState === 'search') {
    lobby[pkt.from] = { name: pkt.nick, ava: pkt.ava, ts: Date.now() };
    drawLobby();

    if (myId > pkt.from) {
      netState = 'call';
      partnerId = pkt.from;
      currentRoomId = 'solo_' + pkt.from + '_' + myId;
      clearInterval(searchLoop);

      participants[pkt.from] = { name: pkt.nick, ava: pkt.ava };
      showSoloRoom(pkt.nick, pkt.ava);

      var matchData = { users: [myId, partnerId], roomId: currentRoomId, to: partnerId };
      socket.emit('match-found', matchData);
      await handleMatchFound(socket, matchData);
    }
  }
  // Подтверждение найденной пары 1 на 1
  else if (pkt.event === 'match-found' && pkt.to === myId && netState === 'search') {
    netState = 'call';
    partnerId = pkt.from;
    currentRoomId = pkt.roomId;
    clearInterval(searchLoop);

    participants[pkt.from] = { name: pkt.nick, ava: pkt.ava };
    showSoloRoom(pkt.nick, pkt.ava);
  }
  // Входящий поиск групповой комнаты (до 6 чел.)
  else if ((pkt.event === 'find-group' || pkt.event === 'group-sync') && netState === 'group') {
    var isNew = !participants[pkt.from];
    if (isNew && Object.keys(participants).length >= 6) return;

    participants[pkt.from] = { name: pkt.nick, ava: pkt.ava };
    drawGroupRoom();

    if (isNew) {
      logMsg(pkt.nick + ' вошёл в руму');
      socket.emit('group-sync', { to: pkt.from, roomId: currentRoomId });
      if (myId > pkt.from) {
        await handleMatchFound(socket, { users: [myId, pkt.from], roomId: currentRoomId });
      }
    }
  }
  // Персональные WebRTC и чат-пакеты
  else if (pkt.to === myId) {
    if (pkt.event === 'send-offer') {
      if (netState === 'group' && !participants[pkt.from] && Object.keys(participants).length < 6) {
        participants[pkt.from] = { name: pkt.nick, ava: pkt.ava };
        drawGroupRoom();
      }
      await handleReceiveOffer(socket, pkt);
} else if (pkt.event === 'send-answer') {
await handleReceiveAnswer(pkt);
} else if (pkt.event === 'ice-candidate') {
await handleIceCandidate(pkt);
} else if (pkt.event === 'chat-msg') {
if (netState === 'call' && pkt.from === partnerId) {
logMsg(pkt.text, 'партнер', pkt.ник, pkt.ava);
} else if (netState === 'группа' && участники [pkt.from]) {
logMsg(pkt.text, 'партнер', pkt.ник, pkt.ava);
}
} else if (pkt.event === 'освободить место') {
if (netState === 'вызов' && pkt.from === partnerId) {
document.getElementById('btnStop').click();
document.getElementById('status').textContent = 'Собеседник вышел из румы';
} else if (netState === 'group' && участники [pkt.from]) {
logMsg(участники[pkt.from].name + ' вышел из румы');
удалить участников[pkt.from];
Закрыть подключение (pkt.from);
Оформить grouproom( );
}
}
}
}
// =========================================================================
// 6. ОТРИСОВКА UI И СВЯЗЬ С ВАШИМИ РАБОЧИМИ КНОПКАМИ
// =========================================================================
function logMsg(txt, cls, senderNick, senderAva) {
var box = document.getElementById('messages');
if (!box) return;
var d = document.createElement('div');
d.className = 'msg ' + (cls || 'sys');
if (cls === 'me' || cls === 'partner') {
d.style.display = 'flex';
d.style.alignItems = 'flex-start';
d.style.gap = '7px';
if (senderAva) {
var img = document.createElement('img');
img.src = senderAva;
img.style.cssText = 'ширина: 20px; высота: 20px; радиус границы: 4px; рендеринг изображения: пиксельный; сжатие: 0; верхнее поле: 2px;';
d.appendChild(img) ;
}
var wrap = document.createElement('div');
var nameTag = document.createElement('div');
nameTag.style.cssText = 'размер шрифта: 0.72rem; непрозрачность: 0.75; вес шрифта: 700; нижнее поле: 2px;';
nameTag.textContent = senderNick || (cls === 'me' ? getMyNick(): 'Собеседник');
var BodyTag = document.createElement('div');
BodyTag.textContent = txt;
обернуть.appendChild(nameTag);
обернуть.appendChild(BodyTag);
d.appendChild(обернуть);
} else {
d.textContent = txt;
}
box.appendChild(d);
box.scrollTop = box.scrollHeight;
}
функция drawLobby() {
var box = document.getElementById('lobbyChips');
возврат if (!box);
box.innerHTML = ";
Object.keys(lobby).forEach(функция(u) {
if (u !== myId && Date.now() - lobby[u].ts > 9000) удалить lobby[u];
});
Object.keys(lobby).forEach(функция(u) {
var c = document.createElement ('div');
c.className = 'chip';
c.style.display = 'inline-flex';
c.style.alignItems = 'center';
c.style.gap = '5px';
var avaSrc = u === myId ? getMyAva() : lobby[u].ava;
if (avaSrc) {
var img = document.createElement('img');
img.src = avaSrc;
img.style.cssText = 'width:14px;height:14px;border-radius:3px;image-rendering:pixelated;';
c.appendChild(img);
}
var span = document.createElement('span');
span.textContent = u === myId ? getMyNick() + ' (Вы)' : lobby[u].name;
c.appendChild(span);
box.appendChild(c);
});
}
function showSoloRoom(pName, pAva) {
if (window.showScr) window.showScr('callView');
document.getElementById('msgInput').disabled = false;
document.getElementById('btnSend').disabled = false;
document.getElementById('messages').innerHTML = '';
var meCard = document.getElementById('roomMeCard');
if (meCard) {
var myAva = getMyAva();
meCard.innerHTML = (myAva ? '' : '🎙️') + '' + getMyNick() + ' (Вы)';
}
var partnerCard = document.getElementById('roomPartnerCard');
if (partnerCard) {
partnerCard.innerHTML = (pAva ? '' : '🎧') + '' + (pName || 'Собеседник') + '';
}
logMsg('Вы вошли в руму с пользователем ' + (pName || 'Собеседник') + ' 👋');
}
функция drawGroupRoom() {
var grid = document.getElementById('groupGrid');
возвращает значение if (!grid);
grid.innerHTML = ";
var ids = Object.keys(участники);
var cnt = document.getElementById('groupCountText');
if (cnt) cnt.textContent = String(ids.length);
for (var i = 0; i < 6; i++) {
var s = document. createElement('div');
if (ids[i]) {
var isMe = ids[i] === myId;
var uName = isMe ? getMyNick() : участники[ids[i]].name;
var uAva = isMe ? getMyAva() : участники[ids[i]].ava;
s.className = 'занятое место';
s.innerHTML = uAva
? '' + uName + ''
: '🎙️' + uName + '';
} else {
s.className = 'seat';
s.innerHTML = '➕Свободно';
}
grid.appendChild(s);
}
}
window.netUpdateProfile = function() {
if (netState === 'search') drawLobby();
if (netState === 'call') {
var meCard = document.getElementById('roomMeCard');
if (meCard) {
var myAva = getMyAva();
meCard.innerHTML = (myAva ? " : '🎙️') + " + getMyNick() + ' (Вы)';
}
}
if (netState === 'group') {
участники[myId] = { имя: getMyNick(), ava: getMyAva() };
drawGroupRoom();
socket.emit('group-sync', { to: '*', roomId: currentRoomId });
}
};
window.netStartSearch = функция(режим) {
window.netStopSession();
initAudio();
if (mode === 'solo') {
netState = 'search';
lobby[myId] = { name: getMyNick(), ava: getMyAva(), ts: Date.now() };
drawLobby();
logMsg('Вы в комнате ожидания собеседника...');
findMatch(socket, 'solo');
searchLoop = setInterval(function() {
if (netState === 'search') {
лобби[myId] = { имя: getMyNick(), ava: getMyAva(), ts: Date.now() };
drawglobby();
findMatch(сокет, 'solo');
}
}, 1000);
} else {
netState = 'group';
CurrentRoom Id = 'group_global_6';
участники[myId] = { имя: getMyNick(), ava: getMyAva() };
drawGroupRoom();
документ .getElementById('msgInput').отключено = false;
document.getElementById('btnSend').отключено = false;
logMsg('Вы вошли в групповую руму (до 6 мест)');
findMatch(сокет, 'группа');
searchLoop = setInterval(функция() {
if (netState === 'группа' && Object.ключи(участники).length < 6) {
findMatch(socket, 'group');
}
}, 1500);
}
};
window.netStopSession = function() {
clearInterval(searchLoop);
if (partnerId) {
socket.emit('leave-room', { to: partnerId, roomId: currentRoomId });
}
if (netState === 'group') {
Object.keys(participants).forEach(function(uid) {
if (uid !== myId) socket.emit('leave-room', { to: uid, roomId: currentRoomId });
});
}
Object.keys(connections).forEach(closePeerConnection);
participants = {};
lobby = {};
partnerId = null;
currentRoomId = null;
netState = 'idle';
};
window.netToggleMute = function(muted) {
if (localStream) {
localStream.getAudioTracks().forEach(function(t) { t.enabled = !muted; });
}
logMsg(muted ? '🔇 Вы выключили микрофон' : '🎙️ Вы включили микрофон');
};
window.netSendChat = function(txt) {
if (netState === 'call' && partnerId) {
logMsg(txt, 'me', getMyNick(), getMyAva());
socket.emit('chat-msg', { to: partnerId, text: txt, roomId: currentRoomId });
} else if (netState === 'group') {
logMsg(txt, 'me', getMyNick(), getMyAva());
Object.keys(participants).forEach(function(uid) {
if (uid !== myId) socket.emit('chat-msg', { to: uid, text: txt, roomId: currentRoomId });
});
}
};
