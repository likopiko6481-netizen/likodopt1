var localStream = null;
var connections = {};
var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' }
  ]
};

window.askMicNow = function() {
  if (localStream) {
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (typeof log === 'function') log('Браузер не поддерживает микрофон');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function(stream) {
      localStream = stream;
      localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      if (typeof log === 'function') log('🎙️ Микрофон включён');
      Object.keys(connections).forEach(function(uid) {
        var pc = connections[uid];
        if (pc && pc.getSenders().length === 0) {
          localStream.getTracks().forEach(function(track) {
            pc.addTrack(track, localStream);
          });
        }
      });
    })
    .catch(function(err) {
      if (typeof log === 'function') log('⚠️ Разрешите микрофон в настройках сайта (' + err.name + ')');
    });
};

function initAudio() {
  if (localStream) return Promise.resolve(localStream);
  window.askMicNow();
  return new Promise(function(resolve) {
    setTimeout(function() { resolve(localStream); }, 400);
  });
}

function closePeer(uid) {
  if (connections[uid]) {
    try { connections[uid].close(); } catch (e) {}
    delete connections[uid];
  }
  var a = document.getElementById('aud_' + uid);
  if (a) a.remove();
}

async function getPeer(uid, sendFn) {
  if (connections[uid]) return connections[uid];
  if (!localStream) await initAudio();

  var pc = new RTCPeerConnection(rtcConfig);
  pc.ontrack = function(e) {
    var a = document.getElementById('aud_' + uid);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'aud_' + uid;
      a.autoplay = true;
      a.playsInline = true;
      a.volume = 1.0;
      var p = document.getElementById('audioPool');
      if (p) p.appendChild(a);
    }
    var remoteStream = (e.streams && e.streams.length > 0) ? e.streams[0] : new MediaStream([e.track]);
    a.srcObject = remoteStream;
    a.play().catch(function() {});
  };

  pc.onicecandidate = function(e) {
    if (e.candidate) sendFn({ ev: 'ice', to: uid, cand: e.candidate });
  };

  if (localStream) {
    localStream.getTracks().forEach(function(t) {
      pc.addTrack(t, localStream);
    });
  }

  connections[uid] = pc;
  return pc;
}
