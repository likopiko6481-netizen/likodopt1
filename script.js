(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  var MY_ID = 'u_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36).slice(-4);
  var MY_NAME = 'Участник #' + Math.floor(100 + Math.random() * 899);
  var CHANNEL = 'https://ntfy.sh';

  var mode = 'solo';
  var state = 'idle';
  var partnerId = null;
  var localStream = null;
  var isMuted = false;

  var clockTimer = null;
  var searchTimer = null;
  var seconds = 0;

  var peers = {};
  var lobby = {};
  var group = {};
  var seen = {};

  var rtcConfig = {
    iceServers: [
      { urls: 'stun:://google.com' },
      { urls: 'stun:://google.com' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };

  function formatTime(sec) {
    var m = String(Math.floor(sec / 60)).padStart(2, '0');
    var s = String(sec % 60).padStart(2, '0');
    return m + ':' + s;
  }

  if (localStorage.getItem('likodopt_cookie_ok') === '1' && $('cookieBanner')) {
    $('cookieBanner').style.display = 'none';
  }
  if ($('btnCloseCookie')) {
    $('btnCloseCookie').addEventListener('click', function () {
      localStorage.setItem('likodopt_cookie_ok', '1');
      if ($('cookieBanner')) $('cookieBanner').style.display = 'none';
    });
  }

  function showScreen(viewId) {
    clearInterval(clockTimer);
    seconds = 0;

    ['idleView', 'queueView', 'callView', 'groupView'].forEach(function (id) {
      if ($(id)) $(id).classList.remove('active');
    });
    if ($(viewId)) $(viewId).classList.add('active');

    if (viewId !== 'idleView') {
      var tId = viewId === 'queueView' ? 'searchTimerText' : (viewId === 'callView' ? 'callTimerText' : 'groupTimerText');
      var el = $(tId);
      if (el) el.textContent = '00:00';
      clockTimer = setInterval(function () {
        seconds++;
        if (el) el.textContent = formatTime(seconds);
      }, 1000);
    }
  }

  function log(text, cls) {
    var box = $('messages');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'msg ' + (cls || 'sys');
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function setChat(enabled) {
    if ($('msgInput')) {
      $('msgInput').disabled = !enabled;
      if (!enabled) $('msgInput').value = '';
    }
    if ($('btnSend')) $('btnSend').disabled = !enabled;
  }

  function renderLobby() {
    var box = $('lobbyChips');
    if (!box) return;
    box.innerHTML = '';
    var now = Date.now();
    Object.keys(lobby).forEach(function (u) {
      if (u !== MY_ID && now - lobby[u].ts > 9000) delete lobby[u];
    });
    Object.keys(lobby).forEach(function (u) {
      var c = document.createElement('div');
      c.className = 'chip';
      c.textContent = u === MY_ID ? '🟢 Вы (' + MY_NAME + ')' : '⏳ ' + lobby[u].name;
      box.appendChild(c);
    });
  }

  function renderGroup() {
    var grid = $('groupGrid');
    if (!grid) return;
    grid.innerHTML = '';
    var ids = Object.keys(group);
    if ($('groupCountText')) $('groupCountText').textContent = String(ids.length);

    for (var i = 0; i < 6; i++) {
      var seat = document.createElement('div');
      if (ids[i]) {
        var uid = ids[i];
        var isMe = uid === MY_ID;
        seat.className = 'seat occupied';
        seat.innerHTML = '<span style="font-size:1.3rem">' + (isMe ? '🎙️' : '🎧') + '</span><span>' + (isMe ? 'Вы' : group[uid]) + '</span>';
      } else {
        seat.className = 'seat';
        seat.innerHTML = '<span style="font-size:1.3rem">➕</span><span>Свободно</span>';
      }
      grid.appendChild(seat);
    }
  }

  function switchMode(newMode) {
    if (state !== 'idle') stopSession(false);
    mode = newMode;
    if ($('btnModeSolo')) $('btnModeSolo').classList.toggle('active', mode === 'solo');
    if ($('btnModeGroup')) $('btnModeGroup').classList.toggle('active', mode === 'group');
    if ($('idleIcon')) $('idleIcon').textContent = mode === 'solo' ? '🎙️' : '👥';
    if ($('status')) {
      $('status').textContent = mode === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6 чел.)';
    }
    showScreen('idleView');
  }

  function initMic() {
    if (localStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('Микрофон недоступен — работает чат');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (s) {
        localStream = s;
        if (isMuted) {
          localStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        }
      })
      .catch(function () {
        log('Доступ к микрофону запрещён — работает чат');
      });
  }

  function closePeer(uid) {
    if (peers[uid]) {
      try { peers[uid].close(); } catch (e) {}
      delete peers[uid];
    }
    var a = $('aud_' + uid);
    if (a) a.remove();
  }

  async function createRtc(to, init, kind) {
    closePeer(to);
    var pc = new RTCPeerConnection(rtcConfig);
    peers[to] = pc;

    if (localStream) {
      localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    }

    pc.ontrack = function (e) {
      var a = $('aud_' + to);
      if (!a) {
        a = document.createElement('audio');
        a.id = 'aud_' + to;
        a.autoplay = true;
        a.playsInline = true;
        if ($('audioPool')) $('audioPool').appendChild(a);
      }
      a.srcObject = new MediaStream([e.track]);
      a.play().catch(function () {});
    };

    pc.onicecandidate = function (e) {
      if (e.candidate) sendSig({ cmd: 'ice', to: to, data: e.candidate });
    };

    if (init) {
      var off = await pc.createOffer();
      await pc.setLocalDescription(off);
      sendSig({ cmd: 'offer', to: to, data: off, kind: kind });
    }
  }

  function startSearch() {
    stopSession(false);
    if ($('btnStop')) $('btnStop').disabled = false;
    if ($('messages')) $('messages').innerHTML = '';
    initMic();

    if (mode === 'solo') {
      state = 'search';
      lobby[MY_ID] = { name: MY_NAME, ts: Date.now() };
      renderLobby();
      showScreen('queueView');
      log('Вы вошли в окно ожидания собеседника...');
      sendSig({ cmd: 'wait_solo', to: '*' });
      searchTimer = setInterval(function () {
        if (state === 'search') {
          lobby[MY_ID].ts = Date.now();
          renderLobby();
          sendSig({ cmd: 'wait_solo', to: '*' });
        }
      }, 1500);
    } else {
      state = 'group';
      group[MY_ID] = MY_NAME;
      renderGroup();
      showScreen('groupView');
      setChat(true);
      log('Вы вошли в групповую комнату (до 6 мест)');
      sendSig({ cmd: 'wait_group', to: '*' });
      searchTimer = setInterval(function () {
        if (state === 'group' && Object.keys(group).length < 6) {
          sendSig({ cmd: 'wait_group', to: '*' });
        }
      }, 2000);
    }
  }

  function stopSession(showStopped) {
    clearInterval(searchTimer);
    clearInterval(clockTimer);
    if (partnerId) sendSig({ cmd: 'bye', to: partnerId, kind: 'solo' });
    if (state === 'group') {
      Object.keys(group).forEach(function (u) {
        if (u !== MY_ID) sendSig({ cmd: 'bye', to: u, kind: 'group' });
      });
    }
    Object.keys(peers).forEach(closePeer);
    for (var k1 in group) delete group[k1];
    for (var k2 in lobby) delete lobby[k2];
    partnerId = null;
    state = 'idle';
    setChat(false);

    if (showStopped) {
      if ($('btnStop')) $('btnStop').disabled = true;
      if ($('status')) $('status').textContent = 'Поиск остановлен';
      showScreen('idleView');
      log('Вы вышли на главный экран');
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach(function (t) { t.enabled = !isMuted; });
    }
    if ($('btnMute')) {
      $('btnMute').textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
      $('btnMute').classList.toggle('muted', isMuted);
    }
    log(isMuted ? 'Микрофон выключен' : 'Микрофон включён');
  }

  function onChatSubmit(e) {
    e.preventDefault();
    var inp = $('msgInput');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) return;

    if (state === 'call' && partnerId) {
      log(text, 'me');
      sendSig({ cmd: 'comm', to: partnerId, kind: 'solo', data: text });
      inp.value = '';
    } else if (state === 'group') {
      log(text, 'me');
      Object.keys(group).forEach(function (u) {
        if (u !== MY_ID) sendSig({ cmd: 'comm', to: u, kind: 'group', data: text });
      });
      inp.value = '';
    }
  }

  function sendSig(payload) {
    var nonce = MY_ID + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var packet = Object.assign({ uco: MY_ID, name: MY_NAME, nonce: nonce, ts: Date.now() }, payload);
    try {
      fetch(CHANNEL, { method: 'POST', body: JSON.stringify(packet) }).catch(function () {});
    } catch (e) {}
  }

  async function handlePacket(pkt) {
    if (pkt.cmd === 'wait_solo' && state === 'search') {
      lobby[pkt.uco] = { name: pkt.name, ts: Date.now() };
      renderLobby();
      if (MY_ID > pkt.uco) {
        state = 'call';
        partnerId = pkt.uco;
        clearInterval(searchTimer);
        sendSig({ cmd: 'pair', to: partnerId, kind: 'solo' });
        showScreen('callView');
        setChat(true);
        if ($('messages')) $('messages').innerHTML = '';
        log('Собеседник найден! Приятного общения 👋');
        createRtc(partnerId, true, 'solo');
      }
    } else if (pkt.cmd === 'pair' && pkt.to === MY_ID && pkt.kind === 'solo' && state === 'search') {
      state = 'call';
      partnerId = pkt.uco;
      clearInterval(searchTimer);
      showScreen('callView');
      setChat(true);
      if ($('messages')) $('messages').innerHTML = '';
log('Собеседник найден!Приятного общения 👋');
createRtc(partnerId, false, 'solo');
} else if (pkt.cmd === 'wait_group' && state === 'group') {
if (!group[pkt.uco] && Object.keys(group).длина < 6) {
group[pkt.uco] = pkt.name;
renderGroup();
log(pkt.name + ' зашёл в комнату');
sendSig({ cmd: 'pair', кому: pkt.uco, вид: 'group' });
if (MY_ID > pkt.uco) createRtc(pkt.uco, true, 'group');
}
} else if (pkt.cmd === 'pair' && pkt.to === MY_ID && pkt.kind === 'group' && state === 'группа') {
if (!group[pkt.uco] && Object.keys(группа).длина < 6) {
группа[pkt.uco] = pkt.name ;
renderGroup();
if (MY_ID > pkt.uco) createRtc(pkt.uco, true, 'group');
}
} else if (pkt.to === MY_ID) {
if (pkt.cmd === 'предложение') {
if (pkt.kind === 'группа' && state === 'группа' && !group[pkt.uco] && Object.keys(группа).длина < 6) {
группа[pkt.uco] = pkt.name ;
renderGroup();
}
ожидает createRtc(pkt.uco, false, pkt.kind);
var pc = peers[pkt.uco];
if (pc) {
ожидает pc.setRemoteDescription(новое RTCSessionDescription(pkt.data));
var ans = ожидает pc.createAnswer();
ожидает pc.setLocalDescription(ans);
отправляет ({ cmd: 'ответ', кому: pkt. uco, данные: ans });
}
} else if (pkt.cmd === 'answer' && peers[pkt.uco]) {
ожидают пиров[pkt.uco].setRemoteDescription(new RTCSessionDescription(pkt.data));
} else if (pkt.cmd === 'ice' && peers[pkt.uco]) {
try { await peers[pkt.uco].addIceCandidate(новый RTCIceCandidate(pkt.data)); } catch (e) {}
} else if (pkt.cmd === 'comm') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) log(pkt.data, 'partner');
if (pkt.kind === 'group' && state === 'group' && group[pkt .uco]) войти(pkt.name + ': ' + pkt.data, 'partner');
} else if (pkt.cmd === 'bye') {
if (pkt.kind === 'solo' && pkt.uco === partnerId) {
stopSession(true);
if ($('status')) $('status').textContent = 'Собеседник отключился';
}
if (pkt.kind === 'group' && state === 'group' && group[pkt.uco ]) {
log(group[pkt.uco] + ' покинул комнату');
delete group[pkt.uco];
closePeer(pkt.uco);
renderGroup();
}
}
}
}
async function poll() {
try {
var res = await fetch(CHANNEL + '/json?poll=1&since=12s');
if (res.ok) {
var text = await res.text();
var lines = text.trim().split('\n');
for (var i = 0; i < lines.length; i++) {
if (!lines[i]) continue;
var wrap = JSON.parse(lines[i]);
if (!wrap.message) continue;
var pkt = JSON.parse(wrap.message);
if (!pkt || pkt.uco === MY_ID || seen[pkt.nonce] || Date.now() - pkt.ts > 16000) continue;
seen[pkt.nonce] = true;
handlePacket(pkt);
}
}
} catch (e) {}
setTimeout(poll, 1000);
}
if ($('btnModeSolo')) $('btnModeSolo').addEventListener('click', function () { switchMode('solo'); });
if ($('btnModeGroup')) $('btnModeGroup').addEventListener('click', function () { switchMode('group'); });
if ($('btnNext')) $('btnNext').addEventListener('click', startSearch);
if ($('btnStop')) $('btnStop').addEventListener('click', function () { stopSession(true); });
if ($('btnMute')) $('btnMute').addEventListener('click', toggleMute);
if ($('chatForm')) $('chatForm').addEventListener('submit', onChatSubmit);
poll();
})();
