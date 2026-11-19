window.localStream = null;
var connections = {};
var iceQueue = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' },
    { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' }
  ]
};

function sayRtc(text) {
  var box = document.getElementById('messages');
  if (!box) return;
  var d = document.createElement('div');
  d.className = 'msg sys';
  d.textContent = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

async function initAudio() {
  if (window.localStream) {
    window.localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return window.localStream;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    sayRtc('⚠️ Браузер не поддерживает микрофон');
    return null;
  }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    window.localStream = stream;
    stream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    sayRtc('🎙️ Микрофон включён');
    return stream;
  } catch (err) {
    sayRtc('⚠️ Доступ к микрофону запрещён (' + err.name + ') — разрешите в адресной строке');
    return null;
  }
}

function closePeer(uid) {
  if (connections[uid]) {
    try { connections[uid].close(); } catch (e) {}
    delete connections[uid];
  }
  delete iceQueue[uid];
  var a = document.getElementById('aud_' + uid);
  if (a) a.remove();
}

window.saveOrAddIce = function(uid, cand) {
  var pc = connections[uid];
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function() {});
  } else {
    if (!iceQueue[uid]) iceQueue[uid] = [];
    iceQueue[uid].push(cand);
  }
};

window.flushIce = function(uid) {
  var pc = connections[uid];
  if (pc && iceQueue[uid]) {
    while (iceQueue[uid].length > 0) {
      pc.addIceCandidate(new RTCIceCandidate(iceQueue[uid].shift())).catch(function() {});
    }
  }
};

async function getPeer(uid, sendFn) {
  if (connections[uid]) return connections[uid];

  var stream = await initAudio();
  var pc = new RTCPeerConnection(rtcConfig);

  if (stream) {
    stream.getTracks().forEach(function(track) {
      pc.addTrack(track, stream);
    });
  }

    pc.ontrack = function(event) {
    var a = document.getElementById('aud_' + uid);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'aud_' + uid;
      a.autoplay = true;
      a.playsInline = true;
      a.volume = 1.0;
      document.body.appendChild(a);
    }
    if (event.streams && event.streams) {
      a.srcObject = event.streams;
    } else {
      var s = new MediaStream();
      s.addTrack(event.track);
      a.srcObject = s;
    }
    a.play().then(function() {
      sayRtc('🔊 Голос собеседника подключён');
    }).catch(function() {
      sayRtc('🔇 Нажмите на экран, чтобы включить звук собеседника');
      document.addEventListener('click', function unlock() {
        a.play();
        document.removeEventListener('click', unlock);
      }, { once: true });
    });
  };

  pc.onicecandidate = function(event) {
    if (event.candidate) {
      sendFn({ ev: 'ice', to: uid, cand: event.candidate });
    }
  };

  connections[uid] = pc;
  return pc;
}
