window.localStream = null;
var connections = {};
var iceQueue = {};

// Дефолтные STUN-серверы для прямого соединения браузеров (P2P)
var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' }
  ]
};

// 1. Дефолтный запрос микрофона у браузера
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
    return stream;
  } catch (err) {
    return null;
  }
}

// 2. Закрытие соединения
function closePeer(uid) {
  if (connections[uid]) {
    connections[uid].close();
    delete connections[uid];
  }
  delete iceQueue[uid];
  var audioEl = document.getElementById('aud_' + uid);
  if (audioEl) audioEl.remove();
}

// 3. Буфер сетевых маршрутов (ICE)
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

// 4. Дефолтное P2P-соединение браузер <-> браузер
async function getPeer(uid, sendFn) {
  if (connections[uid]) return connections[uid];

  var stream = await initAudio();
  var pc = new RTCPeerConnection(rtcConfig);

  // Отдаём свой микрофон собеседнику
  if (stream) {
    stream.getTracks().forEach(function(track) {
      pc.addTrack(track, stream);
    });
  }

  // Принимаем голос собеседника в наушники/динамики
  pc.ontrack = function(event) {
    var audioEl = document.getElementById('aud_' + uid);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'aud_' + uid;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = event.streams[0];
    audioEl.play().catch(function() {});
  };

  // Обмен сетевыми адресами
  pc.onicecandidate = function(event) {
    if (event.candidate) {
      sendFn({ ev: 'ice', to: uid, cand: event.candidate });
    }
  };

  connections[uid] = pc;
  return pc;
}
