var SB_URL = 'https://supabase.co';
var SB_KEY = 'sb_publishable_6Y72t3-gkgmLmoRJGECLMQ_d1azrPSN';

var myId = 'u_' + Math.random().toString(36).slice(2, 9);
var netState = 'idle', partnerId = null, loop = null, lastId = 0;
var lobby = {}, group = {}, seen = {};

var bus = null;
try {
  bus = new BroadcastChannel('likodopt_room_bus');
  bus.onmessage = function(e) { onSignal(e.data); };
} catch (e) {}

function nick() { return window.myNick || 'Гость #' + myId.slice(-3); }
function ava() { return window.myAvaUrl || ''; }

function send(pkt) {
  pkt.from = myId; pkt.nick = nick(); pkt.ava = ava();
  pkt.id = myId + '_' + Date.now() + '_' + Math.random();
  pkt.ts = Date.now();
  if (bus) try { bus.postMessage(pkt); } catch (e) {}

  fetch(SB_URL + '/rest/v1/room_signals', {
    method: 'POST',
    headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ payload: pkt })
  }).catch(function() {});
}

async function poll() {
  try {
    var r = await fetch(SB_URL + '/rest/v1/room_signals?select=id,payload&id=gt.' + lastId + '&order=id.asc&limit=40', {
      headers: { 'apikey': SB_KEY }
    });
    if (r.ok) {
      var rows = await r.json();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id > lastId) lastId = rows[i].id;
        onSignal(rows[i].payload);
      }
    }
  } catch (e) {}
  setTimeout(poll, 850);
}

fetch(SB_URL + '/rest/v1/room_signals?select=id&order=id.desc&limit=1', {
  headers: { 'apikey': SB_KEY }
}).then(function(r) { return r.json(); }).then(function(rows) {
  if (Array.isArray(rows) && rows.length > 0 && rows[0].id) {
    lastId = rows[0].id;
  }
  poll();
}).catch(function() { poll(); });

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
  document.getElementById('groupCountText').textContent = ids.length;
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
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { var ctx = new AC(); if (ctx.state === 'suspended') ctx.resume(); }
  } catch (e) {}

  await initAudio();
  if (mode === 'solo') {
    netState = 'search'; lobby[myId] = nick(); drawLobby(); log('Поиск собеседника...');
    send({ ev: 'w1' });
    loop = setInterval(function() { if (netState === 'search') send({ ev: 'w1' }); }, 1200);
  } else {
    netState = 'group'; group[myId] = { nick: nick(), ava: ava() }; drawGroup(); log('Вы в групповой руме');
    send({ ev: 'w6' });
    loop = setInterval(function() { if (netState === 'group' && Object.keys(group).length < 6) send({ ev: 'w6' }); }, 1800);
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
  if (!p || p.from === myId || seen[p.id] || (p.ts && Date.now() - p.ts > 25000)) return;
  seen[p.id] = 1;

  if (p.ev === 'w1' && netState === 'search') {
    lobby[p.from] = p.nick; drawLobby();
    if (myId > p.from) {
      netState = 'call'; partnerId = p.from; clearInterval(loop);
      send({ ev: 'p1', to: partnerId });
      openSoloRoom(p.nick, p.ava);
      var pc = await getPeer(partnerId, send);
      var off = await pc.createOffer();
      await pc.setLocalDescription(off);
      send({ ev: 'off', to: partnerId, off: off });
    }
  } else if (p.ev === 'p1' && p.to === myId && netState === 'search') {
    netState = 'call'; partnerId = p.from; clearInterval(loop);
    openSoloRoom(p.nick, p.ava);
  } else if (p.ev === 'w6' && netState === 'group' && !group[p.from] && Object.keys(group).length < 6) {
    group[p.from] = { nick: p.nick, ava: p.ava }; drawGroup();
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
