var SUPABASE_URL = 'https://supabase.co';
var SUPABASE_KEY = 'sb_publishable_6Y72t3-gkgmLmoRJGECLMQ_d1azrPSN';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle';
var partnerId = null;
var localStream = null;
var searchLoop = null;
var channel = null;
var peers = {};
var lobby = {};
var group = {};
var seen = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' }
  ]
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

// Подключение через официальный клиент Supabase
function initSupabaseChannel() {
  var st = document.getElementById('netStatus');
  if (!window.supabase) {
    if (st) st.textContent = 'Ошибка загрузки SDK';
    return;
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  channel = client.channel('likodopt_live_room', {
    config: { broadcast: { self: false } }
  });

  channel
    .on('broadcast', { event: 'sig' }, function(msg) {
      var pkt = msg.payload;
      if (!pkt || pkt.uco === myId || seen[pkt.nonce]) return;
      seen[pkt.nonce] = true;
      onPacket(pkt);
    })
    .subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        if (st) st.textContent = 'Онлайн: Сервер подключён';
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (st) st.textContent = 'Ошибка канала: ' + status;
      }
    });
}
initSupabaseChannel();

function sendSig(data) {
  if (!channel) return;
  data.uco = myId;
  data.name = getMyNick();
  data.ava = getMyAva();
  data.nonce = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  channel.send({
    type: 'broadcast',
    event: 'sig',
    payload: data
  });
}

window.netStartSearch = function(mode) {
  window.netStopSession();
  initMic();

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
    Object.keys(group).forEach(function(u) {
      if (u !== myId) sendSig({ cmd: 'comm', to: u, kind: 'group', data: txt });
    });
  }
};

function showFoundPartner(pName, pAva) {
  if (window.showScr) window.showScr('callView');
  document.getElementById('msgInput').disabled = false;
  document.getElementById('btnSend').disabled = false;
  document.getElementById('messages').innerHTML = '';

  var callView = document.getElementById('callView');
  if (callView) {
    var avaBox = callView.querySelector('.avatar');
    if (avaBox && pAva) {
      avaBox.innerHTML = '<img src="' + pAva + '" style="width:100%;height:100%;border-radius:50%;image-rendering:pixelated;">';
    }
    var sub = callView.querySelector('.queue-sub');
    if (sub) sub.textContent = 'Собеседник: ' + (pName || 'Участник');
  }
  logMsg('Собеседник найден: ' + (pName || 'Участник') + ' 👋');
}

async function startRtc(to, init, kind) {
  closePeer(to);
  var pc = new RTCPeerConnection(rtcConfig);
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
если (pkt.cmd === «wait_solo» и netState === «search») {
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
