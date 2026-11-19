var localStream = null;
var connections = {};
var rtcConfig = {
  iceServers: [
    { urls: 'stun:://google.com' },
    { urls: 'stun:://google.com' },
    { urls: 'stun:://cloudflare.com' },
    { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92f62d3e36cafeb80', credential: 'uWdWNcQbcGnxB214' }
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
      var p = document.getElementById('audioPool');
      if (p) p.appendChild(a);
    }
    a.srcObject = (e.streams && e.streams) ? e.streams : new MediaStream([e.track]);
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
