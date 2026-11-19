var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle', partnerId = null, loop = null;
var lobby = {}, group = {}, seen = {};
var mqttClient = null;
var ROOM_TOPIC = 'likodopt/global/v1/signaling';

var bus = null;
try {
  bus = new BroadcastChannel('likodopt_room_bus');
  bus.onmessage = function(e) { onSignal(e.data); };
} catch (e) {}

function nick() { return window.myNick || 'Гость #' + myId.slice(-3); }
function ava() { return window.myAvaUrl || ''; }

// Подключение к глобальному серверу (связывает Инкогнито, телефон и любые города)
function connectGlobalBroker() {
  var st = document.getElementById('netStatus');
  if (!window.mqtt) {
    if (st) st.textContent = 'Локальный режим (вкладки)';
    return;
  }
  try {
    mqttClient = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
      clientId: 'lk_' + myId + '_' + Math.floor(Math.random() * 1000),
      clean: true,
      reconnectPeriod: 2000
    });

    mqttClient.on('connect', function() {
      if (st) st.textContent = 'Онлайн: Глобальный сервер';
      mqttClient.subscribe(ROOM_TOPIC);
    });

    mqttClient.on('message', function(topic, message) {
      try {
        var pkt = JSON.parse(message.toString());
        onSignal(pkt);
      } catch (e) {}
    });

    mqttClient.on('error', function() {
      if (st) st.textContent = 'Переподключение...';
    });
  } catch (e) {}
}
connectGlobalBroker();

function send(pkt) {
  pkt.from = myId;
  pkt.nick = nick();
  pkt.ava = ava();
  pkt.id = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  pkt.ts = Date.now();

  if (bus) {
    try { bus.postMessage(pkt); } catch (e) {}
  }
  if (mqttClient && mqttClient.connected) {
    try { mqttClient.publish(ROOM_TOPIC, JSON.stringify(pkt)); } catch (e) {}
  }
}

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
      s.innerHTML = (uAva ? '<img src="' + uAva + '" style="width:24px;height:24px;border-radius:5px;image-rendering:pixelated;border:1px solid #00e676;">' : '<span>🎙️</span>') + '<span>' + uName + '</span>';
    } else {
      s.className = 'seat';
      s.innerHTML = '<span>➕</span><span>Свободно</span>';
    }
    grid.appendChild(s);
  }
}

function openSoloRoom(pName, pAva) {
  if (window.showScr) window.showScr('callView');
  document.getElementById('msgInput').disabled = false;
  document.getElementById('btnSend').disabled = false;
  document.getElementById('messages').innerHTML = '';
  var mAva = ava();
  document.getElementById('roomMeCard').innerHTML = (mAva ? '<img src="' + mAva + '" style="width:32px;height:32px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;margin-bottom:4px;">' : '<span>🎙️</span>') + '<span>' + nick() + ' (Вы)</span>';
  document.getElementById('roomPartnerCard').innerHTML = (pAva ? '<img src="' + pAva + '" style="width:32px;height:32px;border-radius:6px;image-rendering:pixelated;border:1px solid #00e676;margin-bottom:4px;">' : '<span>🎧</span>') + '<span>' + pName + '</span>';
  log('Вы в руме с ' + pName + ' 👋');
}

window.netStartSearch = async function(mode) {
  window.netStopSession();
  if (typeof initAudio === 'function') await initAudio();

  if (mode === 'solo') {
    netState = 'search';
    lobby[myId] = nick();
    drawLobby();
    log('Поиск собеседника в глобальной сети...');
    send({ ev: 'w1' });
    loop = setInterval(function() { if (netState === 'search') send({ ev: 'w1' }); }, 1200);
  } else {
    netState = 'group';
    group[myId] = { nick: nick(), ava: ava() };
    drawGroup();
    log('Вы в глобальной групповой руме');
    send({ ev: 'w6' });
    loop = setInterval(function() { if (netState === 'group' && Object.keys(group).length < 6) send({ ev: 'w6' }); }, 1800);
  }
};

window.netStopSession = function() {
  clearInterval(loop);
  if (partnerId) send({ ev: 'bye', to: partnerId });
  if (typeof closePeer === 'function' && typeof connections === 'object') {
    Object.keys(connections).forEach(closePeer);
  }
  lobby = {};
  group = {};
  partnerId = null;
  netState = 'idle';
};

window.netToggleMute = function(m) {
  if (window.localStream) {
    window.localStream.getAudioTracks().forEach(function(t) { t.enabled = !m; });
  }
  log(m ? '🔇 Микрофон выключен' : '🎙️ Микрофон включён');
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

  if (p.ev === 'w1' && netState === 'search') {
    lobby[p.from] = p.nick;
    drawLobby();
    if (myId > p.from) {
      netState = 'call';
      partnerId = p.from;
      clearInterval(loop);
      send({ ev: 'p1', to: partnerId });
      openSoloRoom(p.nick, p.ava);
      var pc = await getPeer(partnerId, send);
      var off = await pc.createOffer();
      await pc.setLocalDescription(off);
      send({ ev: 'off', to: partnerId, off: off });
    }
  } else if (p.ev === 'p1' && p.to === myId && netState === 'search') {
    netState = 'call';
    partnerId = p.from;
    clearInterval(loop);
    openSoloRoom(p.nick, p.ava);
  } else if (p.ev === 'w6' && netState === 'group' && !group[p.from] && Object.keys(group).length < 6) {
    group[p.from] = { nick: p.nick, ava: p.ava };
    drawGroup();
    send({ ev: 'w6' });
    if (myId > p.from) {
      var pc6 = await getPeer(p.from, send);
      var off6 = await pc6.createOffer();
      await pc6.setLocalDescription(off6);
      send({ ev: 'off', to: p.from, off: off6 });
    }
  } else if (p.to === myId) {
    if (p.ev === 'off') {
      var pcIn = await getPeer(p.from, send);
      await pcIn.setRemoteDescription(new RTCSessionDescription(p.off));
      if (window.flushIce) window.flushIce(p.from);
      var ans = await pcIn.createAnswer();
      await pcIn.setLocalDescription(ans);
      send({ ev: 'ans', to: p.from, ans: ans });
    } else if (p.ev === 'ans' && connections[p.from]) {
      await connections[p.from].setRemoteDescription(new RTCSessionDescription(p.ans));
      if (window.flushIce) window.flushIce(p.from);
    } else if (p.ev === 'ice') {
      if (window.saveOrAddIce) window.saveOrAddIce(p.from, p.cand);
    } else if (p.ev === 'msg') {
      log(p.txt, 'partner', p.nick);
    } else if (p.ev === 'bye' && p.from === partnerId) {
      document.getElementById('btnStop').click();
    }
  }
}
