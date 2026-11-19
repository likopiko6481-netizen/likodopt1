var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle', partnerId = null, loop = null;
var lobby = {}, group = {}, seen = {};

var bus = new BroadcastChannel('likodopt_room_bus');
bus.onmessage = function(e) { onSignal(e.data); };

function nick() { return window.myNick || 'Гость #' + myId.slice(-3); }
function ava() { return window.myAvaUrl || ''; }

function send(pkt) {
  pkt.from = myId;
  pkt.nick = nick();
  pkt.ava = ava();
  pkt.id = myId + '_' + Date.now() + '_' + Math.random();
  bus.postMessage(pkt);
}

function log(txt, cls, n, a) {
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
  document.getElementById('groupCountText').textContent = ids.length;
  for (var i = 0; i < 6; i++) {
    var s = document.createElement('div');
    s.className = ids[i] ? 'seat occupied' : 'seat';
    s.innerHTML = ids[i] ? '<span>🎙️</span><span>' + (ids[i] === myId ? nick() : group[ids[i]]) + '</span>' : '<span>➕</span><span>Свободно</span>';
    grid.appendChild(s);
  }
}

function openSoloRoom(pName) {
  if (window.showScr) window.showScr('callView');
  document.getElementById('msgInput').disabled = false;
  document.getElementById('btnSend').disabled = false;
  document.getElementById('messages').innerHTML = '';
  document.getElementById('roomMeCard').innerHTML = '<span>🎙️</span><span>' + nick() + ' (Вы)</span>';
  document.getElementById('roomPartnerCard').innerHTML = '<span>🎧</span><span>' + pName + '</span>';
  log('Вы в руме с ' + pName + ' 👋');
}

window.netStartSearch = function(mode) {
  window.netStopSession();
  initAudio();
  if (mode === 'solo') {
    netState = 'search';
    lobby[myId] = nick();
    drawLobby();
    log('Поиск собеседника...');
    send({ ev: 'w1' });
    loop = setInterval(function() { if (netState === 'search') send({ ev: 'w1' }); }, 1000);
  } else {
    netState = 'group';
    group[myId] = nick();
    drawGroup();
    log('Вы в групповой руме');
    send({ ev: 'w6' });
    loop = setInterval(function() { if (netState === 'group') send({ ev: 'w6' }); }, 1500);
  }
};

window.netStopSession = function() {
  clearInterval(loop);
  if (partnerId) send({ ev: 'bye', to: partnerId });
  Object.keys(connections).forEach(closePeer);
  lobby = {}; group = {}; partnerId = null; netState = 'idle';
};

window.netToggleMute = function(m) {
  if (localStream) localStream.getAudioTracks().forEach(function(t) { t.enabled = !m; });
};

window.netSendChat = function(txt) {
  log(txt, 'me', nick());
  if (netState === 'call' && partnerId) send({ ev: 'msg', to: partnerId, txt: txt });
  if (netState === 'group') Object.keys(group).forEach(function(u) { if (u !== myId) send({ ev: 'msg', to: u, txt: txt }); });
};

async function onSignal(p) {
  if (!p || p.from === myId || seen[p.id]) return;
  seen[p.id] = 1;

  if (p.ev === 'w1' && netState === 'search') {
    lobby[p.from] = p.nick;
    drawLobby();
    if (myId > p.from) {
      netState = 'call'; partnerId = p.from; clearInterval(loop);
      send({ ev: 'p1', to: partnerId });
      openSoloRoom(p.nick);
      var pc = getPeer(partnerId, send);
      var off = await pc.createOffer();
      await pc.setLocalDescription(off);
      send({ ev: 'off', to: partnerId, off: off });
    }
  } else if (p.ev === 'p1' && p.to === myId && netState === 'search') {
    netState = 'call'; partnerId = p.from; clearInterval(loop);
    openSoloRoom(p.nick);
  } else if (p.ev === 'w6' && netState === 'group' && !group[p.from] && Object.keys(group).length < 6) {
    group[p.from] = p.nick;
    drawGroup();
    send({ ev: 'w6' });
    if (myId > p.from) {
      var pc6 = getPeer(p.from, send);
      var off6 = await pc6.createOffer();
      await pc6.setLocalDescription(off6);
      send({ ev: 'off', to: p.from, off: off6 });
    }
  } else if (p.to === myId) {
    if (p.ev === 'off') {
      var pcIn = getPeer(p.from, send);
      await pcIn.setRemoteDescription(new RTCSessionDescription(p.off));
      var ans = await pcIn.createAnswer();
      await pcIn.setLocalDescription(ans);
      send({ ev: 'ans', to: p.from, ans: ans });
    } else if (p.ev === 'ans' && connections[p.from]) {
      await connections[p.from].setRemoteDescription(new RTCSessionDescription(p.ans));
    } else if (p.ev === 'ice' && connections[p.from]) {
      try { await connections[p.from].addIceCandidate(new RTCIceCandidate(p.cand)); } catch (e) {}
    } else if (p.ev === 'msg') {
      log(p.txt, 'partner', p.nick);
    } else if (p.ev === 'bye' && p.from === partnerId) {
      document.getElementById('btnStop').click();
    }
  }
}
