window.localStream = window.localStream || null;
var connections = {};
var pendingCandidates = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' }
  ]
};

function initAudio() {
  if (window.localStream) {
    window.localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return Promise.resolve(window.localStream);
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
  return navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(s) {
      window.localStream = s;
      s.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      return s;
    })
    .catch(function() { return null; });
}

function closePeer(uid) {
  if (connections[uid]) {
    try { connections[uid].close(); } catch (e) {}
    delete connections[uid];
  }
  delete pendingCandidates[uid];
  var a = document.getElementById('aud_' + uid);
  if (a) a.remove();
}

// Буфер ICE-кандидатов, чтобы сетевые адреса не терялись до установки соединения
window.saveOrAddIce = function(uid, cand) {
  var pc = connections[uid];
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function() {});
  } else {
    if (!pendingCandidates[uid]) pendingCandidates[uid] = [];
    pendingCandidates[uid].push(cand);
  }
};

window.flushIce = function(uid) {
  var pc = connections[uid];
  var list = pendingCandidates[uid];
  if (pc && list && list.length > 0) {
    while (list.length > 0) {
      var c = list.shift();
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(function() {});
    }
  }
};

async function getPeer(uid, sendFn) {
  if (connections[uid]) {
    if (window.localStream && connections[uid].getSenders().length === 0) {
      window.localStream.getTracks().forEach(function(t) {
        connections[uid].addTrack(t, window.localStream);
      });
    }
    return connections[uid];
  }

  if (!window.localStream) await initAudio();

  var pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = function(e) {
    var a = document.getElementById('aud_' + uid);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'aud_' + uid;
      a.autoplay = true;
      a.playsInline = true;
      a.volume = 1.0;
      document.body.appendChild(a);
    }
    var stream = new MediaStream();
    stream.addTrack(e.track);
    a.srcObject = stream;
    a.play().catch(function() {});

    var box = document.getElementById('messages');
    if (box) {
      var d = document.createElement('div');
      d.className = 'msg sys';
      d.textContent = '🔊 Голосовой канал с собеседником подключён!';
      box.appendChild(d);
    }
  };

  pc.onicecandidate = function(e) {
    if (e.candidate) sendFn({ ev: 'ice', to: uid, cand: e.candidate });
  };

  if (window.localStream) {
    window.localStream.getTracks().forEach(function(t) {
      pc.addTrack(t, window.localStream);
    });
  }

  connections[uid] = pc;
  return pc;
}
