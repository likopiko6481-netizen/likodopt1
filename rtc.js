window.localStream = null;
var connections = {};
var iceQueue = {};

var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' },
    { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' },
    { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' }
  ]
};


function showAudioStatus(text) {
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
    window.localStream.getAudioTracks().forEach(function(track) {
      track.enabled = !window.uiMuted;
    });
    return window.localStream;
  }

  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    window.localStream = stream;
    stream.getAudioTracks().forEach(function(track) {
      track.enabled = !window.uiMuted;
    });
    showAudioStatus('🎙️ Микрофон активен');
    return stream;
  } catch (err) {
    showAudioStatus('⚠️ Ошибка микрофона: ' + err.name + ' (проверьте замок в адресной строке)');
    return null;
  }
}

function closePeer(uid) {
  if (connections[uid]) {
    connections[uid].close();
    delete connections[uid];
  }
  delete iceQueue[uid];
  var audioEl = document.getElementById('aud_' + uid);
  if (audioEl) audioEl.remove();
}

window.saveOrAddIce = function(uid, cand) {
  var pc = connections[uid];
  if (pc && pc.remoteDescription) {
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
    var audioEl = document.getElementById('aud_' + uid);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'aud_' + uid;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.volume = 1.0;
      document.body.appendChild(audioEl);
    }
    var remoteStream = new MediaStream();
    remoteStream.addTrack(event.track);
    audioEl.srcObject = remoteStream;
    audioEl.play().then(function() {
      showAudioStatus('🔊 Звук собеседника пошёл в наушники');
    }).catch(function(e) {
      showAudioStatus('🔇 Браузер заглушил звук: нажмите в любое место экрана (' + e.name + ')');
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
