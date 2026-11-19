var uiMode = 'solo';
var uiMuted = false;
var uiTimer = null;
var uiSec = 0;

if (localStorage.getItem('lk_ck') === '1') {
  document.getElementById('cookieBanner').style.display = 'none';
}

document.getElementById('btnCloseCookie').onclick = function() {
  localStorage.setItem('lk_ck', '1');
  document.getElementById('cookieBanner').style.display = 'none';
};

function showScr(id) {
  clearInterval(uiTimer);
  uiSec = 0;
  ['idleView', 'queueView', 'callView', 'groupView'].forEach(function(v) {
    document.getElementById(v).classList.remove('active');
  });
  document.getElementById(id).classList.add('active');
  if (id !== 'idleView') {
    var tId = id === 'queueView' ? 'searchTimerText' : (id === 'callView' ? 'callTimerText' : 'groupTimerText');
    var tEl = document.getElementById(tId);
    tEl.textContent = '00:00';
    uiTimer = setInterval(function() {
      uiSec++;
      var m = String(Math.floor(uiSec / 60)).padStart(2, '0');
      var s = String(uiSec % 60).padStart(2, '0');
      tEl.textContent = m + ':' + s;
    }, 1000);
  }
}

document.getElementById('btnModeSolo').onclick = function() {
  document.getElementById('btnStop').click();
  uiMode = 'solo';
  this.classList.add('active');
  document.getElementById('btnModeGroup').classList.remove('active');
  document.getElementById('idleIcon').textContent = '🎙️';
  document.getElementById('status').textContent = 'Режим: Соло (1 на 1)';
  showScr('idleView');
};

document.getElementById('btnModeGroup').onclick = function() {
  document.getElementById('btnStop').click();
  uiMode = 'group';
  this.classList.add('active');
  document.getElementById('btnModeSolo').classList.remove('active');
  document.getElementById('idleIcon').textContent = '👥';
  document.getElementById('status').textContent = 'Режим: Групповой (до 6 чел.)';
  showScr('idleView');
};

document.getElementById('btnNext').onclick = function() {
  document.getElementById('btnStop').disabled = false;
  document.getElementById('messages').innerHTML = '';
  if (uiMode === 'solo') {
    showScr('queueView');
  } else {
    showScr('groupView');
    document.getElementById('msgInput').disabled = false;
    document.getElementById('btnSend').disabled = false;
  }
  if (window.netStartSearch) window.netStartSearch(uiMode);
};

document.getElementById('btnStop').onclick = function() {
  clearInterval(uiTimer);
  this.disabled = true;
  document.getElementById('msgInput').disabled = true;
  document.getElementById('btnSend').disabled = true;
  document.getElementById('status').textContent = 'Поиск остановлен';
  showScr('idleView');
  if (window.netStopSession) window.netStopSession();
};

document.getElementById('btnMute').onclick = function() {
  uiMuted = !uiMuted;
  this.textContent = uiMuted ? 'Включить микрофон' : 'Выключить микрофон';
  this.classList.toggle('muted', uiMuted);
  if (window.netToggleMute) window.netToggleMute(uiMuted);
};

document.getElementById('chatForm').onsubmit = function(e) {
  e.preventDefault();
  var inp = document.getElementById('msgInput');
  var txt = inp.value.trim();
  if (!txt) return;
  if (window.netSendChat) window.netSendChat(txt);
  inp.value = '';
};
