var SUPABASE_URL = 'https://supabase.co';
var SUPABASE_KEY = 'sb_publishable_6Y72t3-gkgmLmoRJGECLMQ_d1azrPSN';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle';
var partnerId = null;
var localStream = null;
var searchLoop = null;
var lastRowId = 0;
var peers = {};
var lobby = {};
var group = {};
var seen = {};

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
      s.innerHTML = uAva
        ? '<img src="' + uAva + '" style="width:24px;height:24px;border-radius:5px;image-rendering:pixelated;border:1px solid #00e676;"><span>' + uName + '</span>'
        : '<span>🎙️</span><span>' + uName + '</span>';
    } else {
      s.className = 'seat';
      s.innerHTML = '<span style="font-size:1.3rem">➕</span><span>Свободно</span>';
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
      meCard.innerHTML = (myAva ? '<img src="' + myAva + '" style="width:32px;height:32px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;margin-bottom:4px;">' : '<span style="font-size:1.5rem;">🎙️</span>') + '<span>' + getMyNick() + ' (Вы)</span>';
    }
  }
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
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function(s) {
      localStream = s;
      localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      Object.keys(peers).forEach(function(u) {
        if (peers[u].getSenders().length === 0) {
          localStream.getTracks().forEach(function(t) { peers[u].addTrack(t, localStream); });
        }
      });
    })
    .catch(function() { logMsg('Микрофон недоступен — работает чат'); });
}

function closePeer(u) {
  if (peers[u]) { try { peers[u].close(); } catch (e) {} delete peers[u]; }
  var a = document.getElementById('aud_' + u);
  if (a) a.remove();
}

function sendSig(data) {
  data.uco = myId;
  data.name = getMyNick();
  data.ava = getMyAva();
  data.nonce = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  data.ts = Date.now();

  fetch(SUPABASE_URL + '/rest/v1/room_signals', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ payload: data })
  }).then(function(r) {
    if (!r.ok) {
      logMsg('Ошибка отправки сигнала (' + r.status + ')');
    }
  }).catch(function(err) {
    logMsg('Нет связи с сервером: проверьте интернет');
  });
}

async function pollSignals() {
  try {
    var url = SUPABASE_URL + '/rest/v1/room_signals?select=id,payload&id=gt.' + lastRowId + '&order=id.asc&limit=50';
    var res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    });
    var st = document.getElementById('netStatus');
    if (res.ok) {
      if (st) st.textContent = 'Онлайн: База подключена';
      var rows = await res.json();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id > lastRowId) lastRowId = rows[i].id;
        var pkt = rows[i].payload;
        if (!pkt || pkt.uco === myId || seen[pkt.nonce] || Date.now() - pkt.ts > 30000) continue;
        seen[pkt.nonce] = true;
        onPacket(pkt);
      }
    } else {
      if (st) st.textContent = 'Ошибка БД: ' + res.status;
    }
  } catch (e) {
    var st2 = document.getElementById('netStatus');
    if (st2) st2.textContent = 'Нет ответа от БД';
  }
  setTimeout(pollSignals, 800);
}

// Старт опроса без привязки к старым записям
pollSignals();

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
    }, 1500);
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
    }, 2000);
  }
};

window.netStopSession = function() {
  clearInterval(searchLoop);
  if (partnerId) sendSig({ cmd: 'bye', to: partnerId, kind: 'solo' });
  if (netState === 'group') {
    Object.keys(group).forEach(function(u) { if (u !== myId) sendSig({ cmd: 'bye', to: u, kind: 'group' }); });
  }
  Object.keys(peers).forEach(closePeer);
  group = {}; lobby = {}; partnerId = null; netState = 'idle';
};

window.netToggleMute = function(muted) {
  if (localStream) localStream.getAudioTracks().forEach(function(t) { t.enabled = !muted; });
  logMsg(muted ? '🔇 Вы выключили микрофон' : '🎙️ Вы включили микрофон');
};

window.netSendChat = function(txt) {
  if (netState === 'call' && partnerId) {
    logMsg(txt, 'me', getMyNick(), getMyAva());
    sendSig({ cmd: 'comm', to: partnerId, kind: 'solo', data: txt });
  } else if (netState === 'group') {
    logMsg(txt, 'me', getMyNick(), getMyAva());
    Object.keys(group).forEach(function(u) { if (u !== myId) sendSig({ cmd: 'comm', to: u, kind: 'group', data: txt }); });
  }
};

function showFoundPartner(pName, pAva) {
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
асинхронная функция starttrtc(to, init, kind) {
closePeer(to);
var pc = новое RTCPeerConnection(rtcConfig);
peers[to] = pc;
if (localStream) localStream.getTracks().forEach(функция(t) { pc.addTrack(t, localStream); });
pc.ontrack = функция(e) {
var a = document.getElementById('aud_' + to);
if (!a) { a = document.createElement('аудио'); a.id = 'aud_' + to; a.автозапуск = true; a.playsInline = true; if (document.getElementById('аудиопул')) document.getElementById('аудиопул').appendChild(a); }
a.srcObject = новый медиапоток ([например,дорожка]);
a.play().catch(функция() {});
};
pc.onicecandidate = функция(e) { если (например,кандидат) отправляет сигнал ({ cmd: 'ice', кому: to, данные: e.candidate }); };
if (init) { var off = ожидать pc.createOffer(); ожидать pc.setLocalDescription(выкл.); sendSig({ cmd: 'предложение', кому: to, данные: выкл., вид: kind }); }
}
асинхронная функция onPacket(pkt) {
if (pkt.cmd === 'wait_solo' && netState === 'search') {
лобби[pkt.uco] = { название: pkt.name , ava: pkt.ava, ts: Date.now() }; drawLobby();
if (myId > pkt.ucoo) {
netState = 'вызов'; partnerId = pkt.ucoo; clearInterval(searchLoop);
sendSig({ cmd: 'пара', кому: partnerId, вид: 'соло' });
showFoundPartner(pkt.name , pkt.ava);
startRtc(partnerId, true, 'solo');
}
} else if (pkt.cmd === 'пара' && pkt.to === myId && pkt.kind === 'соло' && netState === 'поиск') {
netState = 'вызов'; partnerId = pkt.uco; clearInterval(searchLoop);
showFoundPartner(pkt.name , pkt.ava);
startRtc(partnerId, false, 'solo');
} else if ((pkt.cmd === 'wait_group' || pkt.cmd === 'upd_group') && netState === 'group') {
var isNew = !group[pkt.uco];
if (isNew && Object.keys(group).длина >= 6) возврат;
group[pkt.uco] = { name: pkt.name, ava: pkt.ava }; drawGroup();
if (isNew) { logMsg(pkt.name + ' зашёл в комнату'); sendSig({ cmd: 'pair', кому: pkt.uco, вид: 'group' }); if (myId > pkt.uco) startRtc(pkt.uco, true, 'group'); }
} else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'group' && netState === 'group' && !группа[pkt.uco] && Object.keys(группа).длина < 6) {
group[pkt.uco] = { имя: pkt.name , ava: pkt.ava }; drawGroup();
if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
} else if (pkt.to === myId) {
if (pkt.cmd === 'предложение') {
if (pkt.kind === 'группа' && netState === 'группа' && !group[pkt.uco] && Object.keys(группа).длина < 6) { группа[pkt.uco] = { название: pkt.name , ava: pkt.ava }; drawGroup(); }
ожидает startRtc(pkt.uco, false, pkt.kind);
ожидает одноранговые узлы[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
var ans = ожидает одноранговые узлы[pkt.uco].createAnswer(); ожидает одноранговые узлы[pkt.uco].setLocalDescription(ans);
Отправляет ({ cmd: 'answer', to : pkt.uco, данные: ans });
} else if (pkt.cmd === 'answer' && peers[pkt.uco ]) ожидает peers[pkt.uco].setRemoteDescription(новое RTCSessionDescription(pkt.data));
else if (pkt.cmd === 'ice' && peers[pkt.uco]) try { ожидает peers[pkt.uco].addIceCandidate(новое RTCIceCandidate(pkt. данные)); } catch (e) {}
else if (pkt.cmd === 'comm') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) logMsg(pkt.data, 'партнер', pkt.name , pkt.ava);
if (pkt.kind === 'group' && netState === 'group' && group[pkt.uco]) logMsg(pkt.data, 'партнер', pkt.name , pkt.ava);
} else if (pkt.cmd === 'пока') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) { document.getElementById('btnStop').click(); document.getElementById('status').textContent = 'Собеседник отключился'; }
if (pkt.kind === 'group' && netState === 'group' && group[pkt.uco]) { logMsg(group[pkt.uco].name + ' вышел'); delete group[pkt.uco]; closePeer(pkt.uco); drawGroup(); }
}
}
}
