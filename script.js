var uiMode = 'solo';
var uiMuted = false;
var uiTimer = null;
var uiSec = 0;

if (localStorage.getItem('likodopt_cookie_ok') === '1') {
  var cb = document.getElementById('cookieBanner');
  if (cb) cb.style.display = 'none';
}

function uiCloseCookie() {
  localStorage.setItem('likodopt_cookie_ok', '1');
  var cb = document.getElementById('cookieBanner');
  if (cb) cb.style.display = 'none';
}

function uiShowView(id) {
  clearInterval(uiTimer);
  uiSec = 0;
  ['idleView', 'queueView', 'callView', 'groupView'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.classList.remove('active');
  });
  var target = document.getElementById(id);
  if (target) target.classList.add('active');

  if (id !== 'idleView') {
    var tId = id === 'queueView' ? 'searchTimerText' : (id === 'callView' ? 'callTimerText' : 'groupTimerText');
    var tEl = document.getElementById(tId);
    if (tEl) tEl.textContent = '00:00';
    uiTimer = setInterval(function() {
      uiSec++;
      var m = String(Math.floor(uiSec / 60)).padStart(2, '0');
      var s = String(uiSec % 60).padStart(2, '0');
      if (tEl) tEl.textContent = m + ':' + s;
    }, 1000);
  }
}

function uiSwitchMode(m) {
  uiStopSession(false);
  uiMode = m;
  document.getElementById('btnModeSolo').classList.toggle('active', m === 'solo');
  document.getElementById('btnModeGroup').classList.toggle('active', m === 'group');
  document.getElementById('idleIcon').textContent = m === 'solo' ? '🎙️' : '👥';
  document.getElementById('status').textContent = m === 'solo' ? 'Режим: Соло (1 на 1)' : 'Режим: Групповой (до 6 чел.)';
  uiShowView('idleView');
}

function uiStartSearch() {
  document.getElementById('btnStop').disabled = false;
  if (uiMode === 'solo') {
    uiShowView('queueView');
  } else {
    uiShowView('groupView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
  }
}

function uiStopSession(toHome) {
  clearInterval(uiTimer);
  document.getElementById('msgInput').disabled = true;
  document.getElementById('btnSend').disabled = true;
  if (toHome) {
    document.getElementById('btnStop').disabled = true;
    document.getElementById('status').textContent = 'Поиск остановлен';
    uiShowView('idleView');
  }
}

function uiToggleMute() {
  uiMuted = !uiMuted;
  var btn = document.getElementById('btnMute');
  btn.textContent = uiMuted ? 'Включить микрофон' : 'Выключить микрофон';
  btn.classList.toggle('muted', uiMuted);
}

function uiSendChat(e) {
  e.preventDefault();
  var inp = document.getElementById('msgInput');
  var txt = inp.value.trim();
  if (!txt) return;
  var box = document.getElementById('messages');
  var d = document.createElement('div');
  d.className = 'msg me';
  d.textContent = txt;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  inp.value = '';
}
