var SUPABASE_URL = 'https://lfdptrycjftjqkprnczd.supabase.co';
var SUPABASE_KEY = 'sb_publishable_6Y72t3-gkgmLmoRJGECLMQ_d1azrPSN';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var myName = 'Участник #' + Math.floor(100 + Math.random() * 899);
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
    { urls: 'stun:://twilio.com' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceCandidatePoolSize: 10
};

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
  Object.keys(lobby).forEach(function(u) {
    if (u !== myId && Date.now() - lobby[u].ts > 9000) delete lobby[u];
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

function initMic() {
  if (localStream) return;
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
      if (window.uiMuted) localStream.getAudioTracks().forEach(function(t) { t.enabled = false; });
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
  var host = SUPABASE_URL.replace('https://', '').replace('http://', '').replace(/\/$/, '');
  var wsUrl = 'wss://' + host + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';

  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = function() {
      var st = document.getElementById('netStatus');
      if (st) st.textContent = 'Онлайн: В сети';
      ws.send(JSON.stringify({
        topic: 'realtime:likodopt_room_2026',
        event: 'phx_join',
        payload: { config: { broadcast: { self: false } } },
        ref: '1'
      }));
      clearInterval(hbTimer);
      hbTimer = setInterval(function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
        }
      }, 25000);
    };

    ws.onmessage = function(e) {
      var f = null;
      try { f = JSON.parse(e.data); } catch (err) { return; }
      if (!f || f.event !== 'broadcast' || !f.payload || !f.payload.payload) return;
      var pkt = f.payload.payload;
      if (!pkt || pkt.uco === myId || seen[pkt.nonce]) return;
      seen[pkt.nonce] = true;
      onPacket(pkt);
    };

    ws.onclose = function() {
      clearInterval(hbTimer);
      setTimeout(connectSupabase, 2000);
    };
  } catch (e) {}
}
connectSupabase();

function sendSig(data) {
  if (!ws || ws.readyState !== 1) return;
  data.uco = myId;
  data.name = myName;
  data.nonce = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  try {
    ws.send(JSON.stringify({
      topic: 'realtime:likodopt_room_2026',
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

  if (mode === 'solo') {
    netState = 'search';
    lobby[myId] = { name: myName, ts: Date.now() };
    drawLobby();
    logMsg('Вы в комнате ожидания собеседника...');
    sendSig({ cmd: 'wait_solo', to: '*' });
    searchLoop = setInterval(function() {
      if (netState === 'search') {
        lobby[myId].ts = Date.now();
        drawLobby();
        sendSig({ cmd: 'wait_solo', to: '*' });
      }
    }, 1500);
  } else {
    netState = 'group';
    group[myId] = myName;
    drawGroup();
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
  logMsg(muted ? 'Микрофон выключен' : 'Микрофон включён');
};

window.netSendChat = function(txt) {
  if (netState === 'call' && partnerId) {
    logMsg(txt, 'me');
    sendSig({ cmd: 'comm', to: partnerId, kind: 'solo', data: txt });
  } else if (netState === 'group') {
    logMsg(txt, 'me');
    Object.keys(group).forEach(function(u) {
      if (u !== myId) sendSig({ cmd: 'comm', to: u, kind: 'group', data: txt });
    });
  }
};

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
  if (pkt.cmd === 'wait_solo' && netState === 'search') {
    lobby[pkt.uco] = { name: pkt.name, ts: Date.now() };
    drawLobby();
    if (myId > pkt.uco) {
      netState = 'call';
      partnerId = pkt.uco;
      clearInterval(searchLoop);
      sendSig({ cmd: 'pair', to: partnerId, kind: 'solo' });
      if (window.showScr) window.showScr('callView');
      document.getElementById('msgInput').disabled = false;
      document.getElementById('btnSend').disabled = false;
      document.getElementById('messages').innerHTML = '';
      logMsg('Собеседник найден! Поздоровайтесь 👋');
      startRtc(partnerId, true, 'solo');
    }
  } else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'solo' && netState === 'search') {
    netState = 'call';
    partnerId = pkt.uco;
    clearInterval(searchLoop);
    if (window.showScr) window.showScr('callView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
    document.getElementById('messages').innerHTML = '';
    logMsg('Собеседник найден! Поздоровайтесь 👋');
    startRtc(partnerId, false, 'solo');
  } else if (pkt.cmd === 'wait_group' && netState === 'group' && !group[pkt.uco] && Object.keys(group).length < 6) {
    group[pkt.uco] = pkt.name;
    drawGroup();
    logMsg(pkt.name + ' зашёл в комнату');
    sendSig({ cmd: 'pair', to: pkt.uco, kind: 'group' });
    if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
  } else if (pkt.cmd === 'pair' && pkt.to === myId && pkt.kind === 'group' && netState === 'group' && !group[pkt.uco] && Object.keys(group).length < 6) {
    group[pkt.uco] = pkt.name;
    drawGroup();
    if (myId > pkt.uco) startRtc(pkt.uco, true, 'group');
} else if (pkt.to === myId) {
if (pkt.cmd === 'offer') {
if (pkt.kind === 'group' && netState === 'group' && !group[pkt.uco] && Object.keys(group).длина < 6) {
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
if (pkt.kind === 'group' && netState === 'group' && group [pkt.uco]) logMsg(pkt.name + ': ' + pkt.data, 'partner');
} else if (pkt.cmd === 'bye') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) {
document.getElementById('btnStop').click();
document.getElementById('status').textContent = 'Собеседник отключился';
}
if (pkt.
logMsg(group[pkt.uco] + ' вышел');
delete group[pkt.uco];
closePeer(pkt.uco);
drawGroup();
}
}
}
}
