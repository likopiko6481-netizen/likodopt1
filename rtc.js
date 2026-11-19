var localStream = null;
var connections = {};
var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' }
  ]
};

function initAudio() {
  if (localStream) {
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
    return Promise.resolve(localStream);
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function(s) {
      localStream = s;
      localStream.getAudioTracks().forEach(function(t) { t.enabled = !window.uiMuted; });
      return localStream;
    })
    .catch(function() { return null; });
}

function closePeer(uid) {
  if (connections[uid]) { try { connections[uid].close(); } catch (e) {} delete connections[uid]; }
  var a = document.getElementById('aud_' + uid);
  if (a) a.remove();
}

function getPeer(uid, sendFn) {
  if (connections[uid]) return connections[uid];
  var pc = new RTCPeerConnection(rtcConfig);
  pc.ontrack = function(e) {
    var a = document.getElementById('aud_' + uid);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'aud_' + uid;
      a.autoplay = true;
      var p = document.getElementById('audioPool');
      if (p) p.appendChild(a);
    }
    a.srcObject = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
    a.play().catch(function() {});
  };
  pc.onicecandidate = function(e) {
    if (e.candidate) sendFn({ ev: 'ice', to: uid, cand: e.candidate });
  };
  if (localStream) {
    localStream.getTracks().forEach(function(t) { pc.addTrack(t, localStream); });
  }
  connections[uid] = pc;
  return pc;
}
