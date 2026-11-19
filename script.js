document.addEventListener('DOMContentLoaded', function() {
  const $ = id => document.getElementById(id);
  const DB = 'https://firebasedatabase.app';
  const me = 'u_' + Math.random().toString(36).slice(2, 9);
  const myName = 'Участник #' + Math.floor(100 + Math.random() * 899);

  let mode = 'solo';
  let st = 'home';
  let soloPid = null;
  let groupRoomId = null;
  let mic = null;
  let muted = false;
  let tInt = null;
  let sInt = null;
  let sec = 0;

  const peers = {};
  const groupMembers = {};
  const seen = new Set();

  if (localStorage.getItem('lk_ck') === '1') $('ckBox').style.display = 'none';
  $('ckClose').addEventListener('click', function() {
    localStorage.setItem('lk_ck', '1');
    $('ckBox').style.display = 'none';
  });

  function setMode(newMode) {
    if (st !== 'home') clickStop(false);
    mode = newMode;
    $('mSolo').classList.toggle('active', mode === 'solo');
    $('mGroup').classList.toggle('active', mode === 'group');
    $('homeIco').textContent = mode === 'solo' ? '🎙️' : '👥';
    $('hTitle').textContent = mode === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6 чел.)';
    $('hSub').textContent = mode === 'solo' ? 'Один на один со случайным собеседником' : 'Общая голосовая комната до 6 человек';
    goScr('home');
  }

  $('mSolo').addEventListener('click', () => setMode('solo'));
  $('mGroup').addEventListener('click', () => setMode('group'));

  function goScr(name) {
    clearInterval(tInt);
    sec = 0;
    ['sHome', 'sSearch', 'sCall', 'sGroup'].forEach(id => $(id).classList.remove('on'));
    const map = { home: 'sHome', search: 'sSearch', call: 'sCall', group: 'sGroup' };
    $(map[name]).classList.add('on');

    if (name === 'search' || name === 'call' || name === 'group') {
      const elId = name === 'search' ? 'tSearch' : (name === 'call' ? 'tCall' : 'tGroup');
      const el = $(elId);
      el.textContent = '00:00';
      tInt = setInterval(() => {
        sec++;
        el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      }, 1000);
    }
  }

  function renderGroupGrid() {
    const grid = $('groupGrid');
    grid.innerHTML = '';
    const ids = Object.keys(groupMembers);
    $('grpCount').textContent = ids.length;

    for (let i = 0; i < 6; i++) {
      const seat = document.createElement('div');
      if (ids[i]) {
        const uid = ids[i];
        seat.className = 'seat occupied';
        seat.innerHTML = '<span class="seat-ico">' + (uid === me ? '🎙️' : '🎧') + '</span><span>' + (uid === me ? 'Вы' : groupMembers[uid]) + '</span>';
      } else {
        seat.className = 'seat';
        seat.innerHTML = '<span class="seat-ico">➕</span><span>Свободно</span>';
      }
      grid.appendChild(seat);
    }
  }

  function log(txt, cls) {
    const d = document.createElement('div');
    d.className = 'm ' + (cls || 'sys');
    d.textContent = txt;
    const box = $('msgs');
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function chatOn(on) {
    $('inp').disabled = !on;
    $('bSend').disabled = !on;
  }

  function post(to, data) {
    fetch(DB + '/in/' + to + '.json', {
      method: 'POST',
      body: JSON.stringify({ f: me, name: myName, t: Date.now(), ...data })
    }).catch(() => {});
  }

  function closePeer(uid) {
    if (peers[uid]) {
      try { peers[uid].close(); } catch (e) {}
      delete peers[uid];
    }
    const aud = document.getElementById('aud_' + uid);
    if (aud) aud.remove();
  }

  function clickNext() {
    clickStop(false);
    $('bStop').disabled = false;
    $('msgs').innerHTML = '';

    if (!mic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
        mic = s;
        if (muted) mic.getAudioTracks().forEach(tr => tr.enabled = false);
        Object.values(peers).forEach(pc => mic.getTracks().forEach(tr => pc.addTrack(tr, mic)));
      }).catch(() => log('Микрофон отключен — работает текстовый чат'));
    }

    if (mode === 'solo') {
      st = 'search';
      goScr('search');
      log('Поиск свободного собеседника (1 на 1)...');
      soloStep();
      sInt = setInterval(soloStep, 1500);
    } else {
      joinGroupRoom();
    }
  }

  function clickStop(showUi) {
    clearInterval(sInt);
    fetch(DB + '/q_solo/' + me + '.json', { method: 'DELETE' }).catch(() => {});

    if (soloPid) post(soloPid, { tp: 'bye' });
    if (groupRoomId) {
      fetch(DB + '/rooms/' + groupRoomId + '/members/' + me + '.json', { method: 'DELETE' }).catch(() => {});
      Object.keys(groupMembers).forEach(uid => { if (uid !== me) post(uid, { tp: 'g_bye' }); });
    }

    Object.keys(peers).forEach(closePeer);
    for (const k in groupMembers) delete groupMembers[k];

    soloPid = null;
    groupRoomId = null;
    st = 'home';
    chatOn(false);

    if (showUi) {
      $('bStop').disabled = true;
      $('hTitle').textContent = 'Диалог завершён';
      goScr('home');
      log('Вы вышли из комнаты');
    }
  }

  function clickMute() {
    muted = !muted;
    if (mic) mic.getAudioTracks().forEach(tr => tr.enabled = !muted);
    const b = $('bMute');
    b.textContent = muted ? 'Включить микрофон' : 'Выключить микрофон';
    b.classList.toggle('on', muted);
  }

  $('bNext').addEventListener('click', clickNext);
  $('bStop').addEventListener('click', () => clickStop(true));
  $('bMute').addEventListener('click', clickMute);

  $('chatForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const inp = $('inp');
    const txt = inp.value.trim();
    if (!txt) return;

    if (st === 'call' && soloPid) {
      log(txt, 'me');
      post(soloPid, { tp: 'txt', v: txt });
      inp.value = '';
    } else if (st === 'group') {
      log(txt, 'me');
      Object.keys(groupMembers).forEach(uid => {
        if (uid !== me) post(uid, { tp: 'g_txt', v: txt });
      });
      inp.value = '';
    }
  });

  async function soloStep() {
    if (st !== 'search') return;
    try {
      await fetch(DB + '/q_solo/' + me + '.json', { method: 'PUT', body: JSON.stringify({ id: me, t: Date.now() }) });
      const r = await fetch(DB + '/q_solo.json');
      const q = await r.json();
      if (!q || st !== 'search') return;
      for (const k of Object.keys(q)) {
        if (k !== me && q[k] && (Date.now() - q[k].t < 10000) && me > k) {
          st = 'conn'; soloPid = k; clearInterval(sInt);
          fetch(DB + '/q_solo/' + me + '.json', { method: 'DELETE' }).catch(() => {});
          fetch(DB + '/q_solo/' + soloPid + '.json', { method: 'DELETE' }).catch(() => {});
          post(soloPid, { tp: 'ok' });
          startSoloCall(true);
          return;
        }
      }
    } catch (e) {}
  }

  async function startSoloCall(init) {
    st = 'call'; goScr('call'); chatOn(true);
    $('msgs').innerHTML = '';
    log('Собеседник найден! Вы в комнате 1 на 1 👋');
    await createRtcWith(soloPid, init, 'solo');
  }

  async function joinGroupRoom() {
    st = 'group';
    goScr('group');
    chatOn(true);
    groupMembers[me] = myName;
    renderGroupGrid();
    log('Подключаемся к групповой комнате (до 6 человек)...');

    try {
      const r = await fetch(DB + '/rooms.json');
      const rooms = (await r.json()) || {};
      let chosenRoom = null;
      const now = Date.now();

      for (const rId of Object.keys(rooms)) {
        const mems = rooms[rId] && rooms[rId].members ? rooms[rId].members : {};
        const activeIds = Object.keys(mems).filter(uid => now - mems[uid].t < 12000);
        if (activeIds.length > 0 && activeIds.length < 6) {
          chosenRoom = rId;
          break;
        }
      }

      if (!chosenRoom) {
        chosenRoom = 'room_' + Math.random().toString(36).slice(2, 8);
      }
      groupRoomId = chosenRoom;
      log('Вы вошли в комнату. Ожидаем участников (до 6 мест)...');

      await syncGroupRoom();
      sInt = setInterval(syncGroupRoom, 2500);
    } catch (e) {}
  }

  async function syncGroupRoom() {
    if (st !== 'group' || !groupRoomId) return;
    try {
      await fetch(DB + '/rooms/' + groupRoomId + '/members/' + me + '.json', {
        method: 'PUT',
        body: JSON.stringify({ name: myName, t: Date.now() })
      });

      const r = await fetch(DB + '/rooms/' + groupRoomId + '/members.json');
      const mems = (await r.json()) || {};
      const now = Date.now();

      for (const uid of Object.keys(mems)) {
        if (uid === me) continue;
        if (now - mems[uid].t > 12000) {
          if (groupMembers[uid]) {
            log(groupMembers[uid] + ' вышел из комнаты');
            delete groupMembers[uid];
            closePeer(uid);
          }
          continue;
        }
        if (!groupMembers[uid] && Object.keys(groupMembers).length < 6) {
          groupMembers[uid] = mems[uid].name || 'Участник';
          log(groupMembers[uid] + ' присоединился к комнате!');
          if (me > uid && !peers[uid]) {
            await createRtcWith(uid, true, 'group');
          }
        }
      }
      renderGroupGrid();
    } catch (e) {}
  }

  async function createRtcWith(targetId, isInitiator, callType) {
    closePeer(targetId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:://google.com' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });
    peers[targetId] = pc;

    if (mic) mic.getTracks().forEach(tr => pc.addTrack(tr, mic));

    pc.ontrack = e => {
      let aud = document.getElementById('aud_' + targetId);
      if (!aud) {
        aud = document.createElement('audio');
        aud.id = 'aud_' + targetId;
        aud.autoplay = true;
        aud.playsInline = true;
        $('audioPool').appendChild(aud);
      }
      aud.srcObject = new MediaStream([e.track]);
      aud.play().catch(() => {});
    };

pc.onicecandidate = e => {
if (e.candidate) post(targetId, { tp: 'c', c: e.candidate });
};
if (isInitiator) {
const o = ожидание pc.createOffer();
ожидание pc.setLocalDescription(o);
post(TargetID, { tp: 'o', o, CallType });
}
}
setInterval(async () => {
try {
const r = await fetch(DB + '/in/' + me + '.json');
const msgs = await r.json();
if (!msgs) return;
fetch(DB + '/in/' + me + '.json', { метод: 'DELETE' }).catch(() => {});
для (const k объектных ключей(msgs)) {
if (seen.has(k)) continue;
seen.add(k);
const m = msgs[k];
if (!m || Date.now() - m.t > 20000) continue;
если (m.tp === 'ok' && st === 'search') {
st = 'conn'; soloPid = m.f; clearInterval(sInt);
startSoloCall(false);
} иначе, если (m.tp === 'o') {
if (m.CallType === 'group' && st === 'группа') {
if (!Члены группы[m.f] && Object.keys(Члены группы).длина < 6) {
Члены группы[m.f] = m.name || 'Участник';
renderGroupGrid();
}
ожидает createRtcWith(m.f, false, 'group');
}
const pc = peers[m.f];
if (pc) {
ожидает pc.setRemoteDescription(новое RTCSessionDescription(m.o));
const a = ожидает pc.createAnswer();
ожидает pc.setLocalDescription(a);
post(m.f, { tp: 'a' , a });
}
} иначе, если (m.tp === 'a' && peers[m.f]) {
ожидают peers[m.f].setRemoteDescription(новое RTCSessionDescription(m.a));
} иначе, если (m.tp === 'c' && peers[m.f]) {
try { await peers[m.f].addIceCandidate(новый RTCIceCandidate(m.c)); } catch (e) {}
} else if (m.tp === 'txt' && m.f === soloPid) {
log(m.v, 'he');
} иначе, если (m.tp === 'g_txt' && st === 'group' && GroupMembers[m.f]) {
журнал((m.name || 'Участник') + ': ' + m.v, 'он');
} иначе, если (m.tp === 'bye' && m.f === soloPid) {
clickStop(true);
$('hTitle').textContent = 'Собеседник отключился';
} иначе, если (m.tp === 'g_bye' && st === 'group' && GroupMembers[m.f]) {
войти(GroupMembers[m.f] + ' покинул комнату');
удалить GroupMembers[m.f];
closePeer(m.f);
renderGroupGrid();
}
}
} catch (e) {}
}, 1000);
});
