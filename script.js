var SUPABASE_URL = 'https://supabase.co';
var SUPABASE_KEY = 'ВСТАВЬТЕ_СЮДА_ВАШ_КЛЮЧ_eyJhbGci...';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle';
var partnerId = null;
var localStream = null;
var searchLoop = null;
var hbTimer = null;
var ws = null;
var peers = {};
var lobby = {};
var group = {};
var seen = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' }
  ],
  iceCandidatePoolSize: 10
};

function getMyNick() {
  return window.myNick || 'Участник #' + myId.slice(-3);
}

function getMyAva() {
  return window.myAvaUrl || '';
}

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
      img.style.cssText = 'width:20px;height:20px;border-radius:4px;image-rendering:pixelated;flex-shrink:0;margin-top:2px;';
      d.appendChild(img);
    }
    var wrap = document.createElement('div');
    var nameTag = document.createElement('div');
    nameTag.style.cssText = 'font-size:0.72rem;opacity:0.75;font-weight:700;margin-bottom:2px;';
    nameTag.textContent = senderNick || (cls === 'me' ? getMyNick() : 'Собеседник');
    var bodyTag = document.createElement('div');
    bodyTag.textContent = txt;
    wrap.appendChild(nameTag);
    wrap.appendChild(bodyTag);
    d.appendChild(wrap);
  } else {
    d.textContent = txt;
  }
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function drawLobby() {
  var box = document.getElementById('lobbyChips');
  if (!box) return;
  box.innerHTML = '';
  Object.keys(lobby).forEach(function(u) {
    if (u !== myId && Date.now() - lobby[u].ts > 9000) delete lobby[u];
  });
  Object.keys(lobby).forEach(function(u) {
    var c = document.createElement('div');
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
      var uName = isMe ? getMyNick() : group[ids[i]].name;
      var uAva = isMe ? getMyAva() : group[ids[i]].ava;
      s.className = 'seat occupied';
      if (uAva) {
        s.innerHTML = '<img src="' + uAva + '" style="width:24px;height:24px;border-radius:5px;image-rendering:pixelated;border:1px solid #00e676;"><span>' + uName + '</span>';
      } else {
        s.innerHTML = '<span>🎙️</span><span>' + uName + '</span>';
      }
    } else {
      s.className = 'seat';
      s.innerHTML = '<span style="font-size:1.3rem">➕</span><span>Свободно</span>';
    }
    grid.appendChild(s);
  }
}

window.netUpdateProfile = function() {
  if (netState === 'search') drawLobby();
  if (netState === 'group') {
    group[myId] = { name: getMyNick(), ava: getMyAva() };
    drawGroup();
    sendSig({ cmd: 'upd_group', to: '*' });
  }
};

function initMic() {
  if (localStream) {
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logMsg('Микрофон недоступен — работает чат');
    return;
  }
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  })
    .then(function(s) {
      localStream = s;
      localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      Object.keys(peers).forEach(function(u) {
        if (peers[u].getSenders().length === 0) {
          localStream.getTracks().forEach(function(t) { peers[u].addTrack(t, localStream); });
        }
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

function connectSupabase() {
  var st = document.getElementById('netStatus');
  if (!SUPABASE_KEY || SUPABASE_KEY.indexOf('ВСТАВЬТЕ') !== -1) {
    if (st) st.textContent = 'Ошибка: вставьте ключ в net.js';
    return;
  }

  var host = SUPABASE_URL.replace('https://', '').replace('http://', '').replace(/\/$/, '');
  var wsUrl = 'wss://' + host + '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPABASE_KEY) + '&vsn=1.0.0';

  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = function() {
      if (st) st.textContent = 'Онлайн: Подключено';
      ws.send(JSON.stringify({
        topic: 'realtime:likodopt_global_room',
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: myId }
          },
          access_token: SUPABASE_KEY
        },
        ref: '1'
      }));
      clearInterval(hbTimer);
      hbTimer = setInterval(function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
        }
      }, 20000);
    };

    ws.onmessage = function(e) {
      var f = null;
      try { f = JSON.parse(e.data); } catch (err) { return; }
      if (!f) return;

      if (f.event === 'phx_reply' && f.ref === '1') {
        if (f.payload && f.payload.status === 'ok') {
          if (st) st.textContent = 'Онлайн: Канал активен';
        } else {
          if (st) st.textContent = 'Ошибка доступа Supabase';
          logMsg('Сервер отклонил вход: включите Allow public access в Realtime или проверьте ключ');
        }
        return;
      }

      if (f.event !== 'broadcast' || !f.payload || !f.payload.payload) return;
      var pkt = f.payload.payload;
      if (!pkt || pkt.uco === myId || seen[pkt.nonce]) return;
      seen[pkt.nonce] = true;
      onPacket(pkt);
    };

    ws.onerror = function() {
      if (st) st.textContent = 'Ошибка сети WebSocket';
    };

    ws.onclose = function() {
      if (st) st.textContent = 'Переподключение...';
      clearInterval(hbTimer);
      setTimeout(connectSupabase, 2000);
    };
  } catch (e) {}
}
connectSupabase();

function sendSig(data) {
  if (!ws || ws.readyState !== 1) return;
  data.uco = myId;
  data.name = getMyNick();
  data.ava = getMyAva();
  data.nonce = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  try {
    ws.send(JSON.stringify({
      topic: 'realtime:likodopt_global_room',
      event: 'broadcast',
      payload: { type: 'broadcast', event: 'sig', payload: data },
      ref: String(Date.now())
    }));
  } catch (e) {}
}

window.netStartSearch = function(mode) {
  window.netStopSession();
  initMic();

  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      var ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
    }
  } catch (e) {}

  if (!ws || ws.readyState !== 1) {
    logMsg('Подключаемся к серверу поиска...');
  }

  if (mode === 'solo') {
    netState = 'search';
    lobby[myId] = { name: getMyNick(), ava: getMyAva(), ts: Date.now() };
    drawLobby();
    logMsg('Вы в комнате ожидания собеседника...');
    sendSig({ cmd: 'wait_solo', to: '*' });
    searchLoop = setInterval(function() {
      if (netState === 'search') {
        lobby[myId] = { name: getMyNick(), ava: getMyAva(), ts: Date.now() };
        drawLobby();
        sendSig({ cmd: 'wait_solo', to: '*' });
      }
    }, 1200);
  } else {
    netState = 'group';
    group[myId] = { name: getMyNick(), ava: getMyAva() };
    drawGroup();
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
    logMsg('Вы вошли в групповую комнату (до 6 мест)');
    sendSig({ cmd: 'wait_group', to: '*' });
    searchLoop = setInterval(function() {
      if (netState === 'group' && Object.keys(group).length < 6) {
        sendSig({ cmd: 'wait_group', to: '*' });
      }
    }, 1800);
  }
};

window.netStopSession = function() {
  clearInterval(searchLoop);
  if (partnerId) sendSig({ cmd: 'bye', to: partnerId, kind: 'solo' });
  if (netState === 'group') {
    Object.keys(group).forEach(function(u) {
      if (u !== myId) sendSig({ cmd: 'bye', to: u, kind: 'group' });
    });
  }
  Object.keys(peers).forEach(closePeer);
  group = {};
  lobby = {};
  partnerId = null;
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
    sendSig({ cmd: 'comm', to: partnerId, kind: 'solo', data: txt });
  } else if (netState === 'group') {
logMsg(txt, 'me', getMyNick(), getMyAva());
Object.keys(group).forEach(функция(u) {
if (u !== myId) отправляет сигнал({ cmd: 'comm', кому: u, вид: 'group', данные: txt });
});
}
};
функция showFoundPartner(pName, pAva) {
if (window.showScr) window.showScr('callView');
document.getElementById('msgInput').disabled = false;
document.getElementById('btnSend').disabled = false;
document.getElementById('сообщения').innerHTML = ";
var callView = document.getElementById('callView');
if (callView) {
var avaBox = callView.querySelector('.avatar');
if (avaBox && pAva) {
avaBox.innerHTML = '';
}
var sub = callView.querySelector('.queue-sub');
if (sub) sub.textContent = 'Собеседник: ' + (pName || 'Участник');
}
logMsg('Собеседник найден: ' + (pName || 'Участник') + ' 👋');
}
асинхронная функция starttrtc(to, init, kind) {
closePeer(to);
var pc = новое RTCPeerConnection(rtcConfig);
peers[to] = pc;
if (localStream) {
localStream.getTracks().forEach(функция(t) { pc.addTrack(t, localStream); });
}
pc.ontrack = функция(e) {
var a = document.getElementById('aud_' + to);
if ( !a) {
a = document.createElement('аудио');
a.id = 'aud_' + to;
a.autoplay = true;
a.playsInline = true;
var pool = document.getElementById('аудиопул');
if (pool) pool.appendChild(a);
}
a.srcObject = новый медиапоток ([например,дорожка]);
a.play().catch(функция() {});
};
pc.onicecandidate = функция(e) {
если (например,кандидат) отправляет сигнал ( { cmd: 'ice', кому: to, данные: e.candidate });
};
if (init) {
var off = ожидание pc.createOffer();
ожидание pc.setLocalDescription(выключено);
sendSig({cmd: 'предложение', кому: to, данные: выключены, вид: kind });
}
}
асинхронная функция onPacket(pkt) {
if (pkt.cmd === 'wait_solo' && netState === 'search') {
лобби[pkt.uco] = { название: pkt.name , ava: pkt.ava, ts: Date.now() };
drawLobby();
if (myId > pkt.ucoo) {
netState = 'вызов';
partnerId = pkt.ucoo;
clearInterval(searchLoop);
sendSig({ cmd: 'пара', кому: partnerId, вид: 'соло' });
showFoundPartner(pkt.name , pkt.ava);
startRtc(partnerId, true, 'solo');
}
} else if (pkt.cmd === 'пара' && pkt.to === myId && pkt.kind === 'соло' && netState === 'поиск') {
netState = 'вызов';
partnerId = pkt.uco;
clearInterval(searchLoop);
showFoundPartner(pkt.name , pkt.ava);
startRtc(partnerId, false, 'solo');
} else if ((pkt.cmd === 'wait_group' || pkt.cmd === 'upd_group') && netState === 'group') {
var isNew = !group[pkt.uco];
if (isNew && Object.keys(group).длина >= 6) возврат;
group[pkt.uco] = { name: pkt.name, ava: pkt.ava };
drawGroup();
if (isNew) {
logMsg(pkt.name + ' зашёл в комнату');
Отправляет ({ cmd: 'pair', кому: pkt.uco, вид: 'group' });
if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
}
} else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'group' && netState === 'group' && !группа[pkt.uco] && Object.keys(группа).length < 6) {
group[pkt.uco] = { name: pkt.name, ava: pkt.ava };
drawGroup();
if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
} else if (pkt.to === myId) {
if (pkt.cmd === 'offer') {
if (pkt.kind === 'group' && netState === 'group' && !group[pkt.uco] && Object.keys(group).длина < 6) {
группа[pkt.uco] = { название: pkt.name , ava: pkt.ava };
drawGroup();
}
ожидает startRtc(pkt.uco, false, pkt.kind);
ожидает одноранговые узлы[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
var ans = ожидает одноранговые узлы[pkt.uco].createAnswer();
ожидает одноранговые узлы[pkt.uco].setLocalDescription(ans);
Отправляет ({ cmd: 'ответ ', кому: pkt.uco, данные: ans });
} else if (pkt.cmd === 'answer' && peers[pkt.uco]) {
ожидают peers[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
} else if (pkt.cmd === 'ice' && peers[pkt.uco]) {
try { await peers[pkt.uco].addIceCandidate(новый RTCIceCandidate(pkt.data)); } catch (e) {}
} else if (pkt.cmd === 'comm') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) logMsg(pkt.data, 'партнер', pkt.name , pkt.ava);
if (pkt.kind === 'group' && netState === 'group' && group[pkt.uco]) logMsg(pkt.data, 'партнер', pkt.name , pkt.ava);
} else if (pkt.cmd === 'bye') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) {
document.getElementById('btnStop').click();
document.getElementById('status').textContent = 'Собеседник отключился';
}
if (pkt.kind === 'group' && netState === 'group' && group[pkt.uco]) {
logMsg(group[pkt.uco].name + ' вышел');
delete group[pkt.uco];
closePeer(pkt.uco);
drawGroup();
}
}
}
}
