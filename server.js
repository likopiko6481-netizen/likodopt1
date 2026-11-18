const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const users = new Map();
let waitingQueue = [];
const pairs = new Map();

function ensureUser(id) {
    if (!users.has(id)) {
        users.set(id, { lastSeen: Date.now(), events: [] });
    }
    const u = users.get(id);
    u.lastSeen = Date.now();
    return u;
}

function pushEvent(id, ev) {
    const u = users.get(id);
    if (u) u.events.push(ev);
}

function removeFromQueue(id) {
    waitingQueue = waitingQueue.filter(cid => cid !== id);
}

function disconnectPartner(id) {
    const partnerId = pairs.get(id);
    if (partnerId) {
        pairs.delete(id);
        pairs.delete(partnerId);
        pushEvent(partnerId, { type: 'partner_disconnected' });
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [id, u] of users.entries()) {
        if (now - u.lastSeen > 12000) {
            users.delete(id);
            removeFromQueue(id);
            disconnectPartner(id);
        }
    }
}, 4000);

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="google" content="notranslate">
    <title>Likodopt — Голосовая чат-рулетка</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: url('/bg') no-repeat center center fixed, #0f1115;
            background-size: cover;
            color: #fff;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 15px;
        }
        .app {
            background: rgba(24, 27, 34, 0.90);
            backdrop-filter: blur(8px);
            width: 100%;
            max-width: 460px;
            border-radius: 20px;
            padding: 25px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            border: 1px solid #262a35;
        }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .logo { font-size: 1.5rem; font-weight: 800; color: #00e676; letter-spacing: 1px; }
        .online-badge { background: #232834; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; color: #a0aab8; display: flex; align-items: center; }
        .online-dot { width: 8px; height: 8px; background: #ff5252; border-radius: 50%; margin-right: 6px; transition: background 0.3s; }
        .online-dot.connected { background: #00e676; }
        .voice-box { background: rgba(18, 20, 26, 0.85); border-radius: 16px; padding: 22px 15px; text-align: center; margin-bottom: 15px; border: 1px solid #222630; }
        .avatar { width: 72px; height: 72px; border-radius: 50%; background: #232834; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-size: 2rem; }
        .avatar.speaking { box-shadow: 0 0 0 6px rgba(0, 230, 118, 0.35); background: #1c382c; }
        #status { font-size: 1rem; color: #cfd8e3; font-weight: 500; }
        .queue-window { display: none; flex-direction: column; align-items: center; padding: 10px 5px; }
        .queue-window.active { display: flex; }
        .radar { position: relative; width: 76px; height: 76px; border-radius: 50%; background: rgba(0, 230, 118, 0.12); border: 2px solid #00e676; display: flex; align-items: center; justify-content: center; font-size: 1.9rem; margin-bottom: 14px; }
        .radar::before { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #00e676; animation: pulseRing 2s infinite ease-out; }
        @keyframes pulseRing { 0% { transform: scale(0.95); opacity: 0.8; } 100% { transform: scale(1.55); opacity: 0; } }
        .queue-title { font-size: 1.05rem; font-weight: 700; color: #00e676; margin-bottom: 6px; }
        .queue-sub { font-size: 0.85rem; color: #a0aab8; margin-bottom: 10px; }
        .queue-timer { background: #232834; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; border: 1px solid #323846; }
        .chat-box { background: rgba(18, 20, 26, 0.85); border-radius: 14px; height: 180px; display: flex; flex-direction: column; margin-bottom: 15px; border: 1px solid #222630; overflow: hidden; }
        #messages { flex: 1; padding: 12px; overflow-y: auto; font-size: 0.9rem; display: flex; flex-direction: column; gap: 8px; }
        .msg { padding: 8px 12px; border-radius: 10px; max-width: 82%; word-wrap: break-word; }
        .msg.me { background: #00e676; color: #000; align-self: flex-end; font-weight: 500; }
        .msg.partner { background: #262b38; color: #fff; align-self: flex-start; }
        .msg.sys { background: transparent; color: #788292; align-self: center; font-size: 0.8rem; text-align: center; }
        .chat-input { display: flex; border-top: 1px solid #222630; }
        .chat-input input { flex: 1; background: transparent; border: none; padding: 12px; color: #fff; outline: none; font-size: 0.9rem; }
        .chat-input button { background: transparent; border: none; color: #00e676; font-weight: bold; padding: 0 18px; font-size: 1.1rem; cursor: pointer; }
        .chat-input button:disabled { color: #555; }
        .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .btn { padding: 15px; border: none; border-radius: 12px; font-size: 1rem; font-weight: 700; cursor: pointer; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        #btnNext { background: #00e676; color: #000; }
        #btnStop { background: #ff5252; color: #fff; }
        #btnMute { grid-column: span 2; background: #262b38; color: #fff; font-weight: 600; }
        #btnMute.muted { background: #ff9800; color: #000; }
        .cookie-banner { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); width: calc(100% - 30px); max-width: 460px; background: rgba(24, 27, 34, 0.96); border: 1px solid rgba(0, 230, 118, 0.35); border-radius: 16px; padding: 14px 16px; display: none; align-items: center; justify-content: space-between; gap: 12px; z-index: 999; }
        .cookie-banner.show { display: flex; }
        .cookie-text { font-size: 0.88rem; color: #e6ecf5; line-height: 1.4; }
        .cookie-text span { color: #00e676; font-weight: 700; }
        .cookie-close { background: #262b38; color: #a0aab8; border: 1px solid #353b4d; border-radius: 50%; width: 34px; height: 34px; min-width: 34px; display: flex; align-items: center; justify-content: center; font-size: 1rem; cursor: pointer; }
    </style>
</head>
<body>
<div class="app">
    <div class="header">
        <div class="logo">LIKODOPT</div>
        <div class="online-badge"><span class="online-dot" id="connDot"></span>Онлайн: <span id="onlineCount">0</span></div>
    </div>
    <div class="voice-box">
        <div id="idleView">
            <div class="avatar" id="partnerAvatar">🎙️</div>
            <div id="status">Подключение к серверу...</div>
        </div>
        <div class="queue-window" id="queueView">
            <div class="radar">🔍</div>
            <div class="queue-title">Вы в очереди ожидания</div>
            <div class="queue-sub">Подбираем свободного собеседника...</div>
            <div class="queue-timer">Время поиска: <span id="searchTimerText">00:00</span></div>
        </div>
    </div>
    <div class="chat-box">
        <div id="messages"></div>
        <form class="chat-input" id="chatForm">
            <input type="text" id="msgInput" placeholder="Написать сообщение..." disabled autocomplete="off">
            <button type="submit" id="btnSend" disabled>➤</button>
        </form>
    </div>
    <div class="controls">
        <button type="button" class="btn" id="btnNext">Найти / Далее</button>
        <button type="button" class="btn" id="btnStop" disabled>Стоп</button>
        <button type="button" class="btn" id="btnMute" disabled>Выключить микрофон</button>
    </div>
    <audio id="remoteAudio" autoplay playsinline></audio>
</div>
<div class="cookie-banner" id="cookieBanner">
    <div class="cookie-text">🍪 Мы используем ваши файлы <span>Cookie</span> для улучшения работы сайта.</div>
    <button type="button" class="cookie-close" id="closeCookieBtn">✕</button>
</div>
<script>
    function setCookie(name, value, days) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = name + "=" + encodeURIComponent(value) + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
    }
    function getCookie(name) {
        const prefix = name + "=";
        const parts = document.cookie.split(';');
        for (let i = 0; i < parts.length; i++) {
            let c = parts[i].trim();
            if (c.indexOf(prefix) === 0) return decodeURIComponent(c.substring(prefix.length));
        }
        return null;
    }

    const cookieBanner = document.getElementById('cookieBanner');
    if (!getCookie('likodopt_cookie_closed')) cookieBanner.classList.add('show');
    document.getElementById('closeCookieBtn').onclick = function() {
        setCookie('likodopt_cookie_closed', '1', 30);
        cookieBanner.classList.remove('show');
    };

    const idleView = document.getElementById('idleView');
    const queueView = document.getElementById('queueView');
    const searchTimerText = document.getElementById('searchTimerText');
    const statusEl = document.getElementById('status');
    const onlineCountEl = document.getElementById('onlineCount');
    const connDot = document.getElementById('connDot');
    const partnerAvatar = document.getElementById('partnerAvatar');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const msgInput = document.getElementById('msgInput');
const btnSend = document.getElementById('btnSend');
const btnNext = document.getElementById('btnNext');
const btnStop = document.getElementById('btnStop');
const btnMute = document.getElementById('btnMute');
const remoteAudio = document.getElementById('remoteAudio');
const myId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let isConnected = false;
let localStream = null;
let pc = null;
let isMuted = false;
let clockInterval = null;
let searchSeconds = 0;
const rtcConfig = {
iceServers: [
{ urls: 'stun:google.com' },
{ urls: 'stun:google.com' },
{ urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
{ urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
]
};
function showQueueWindow(show) {
if (show) {
idleView.style.display = 'none';
queueView.classList.add('active');
searchSeconds = 0;
searchTimerText.textContent = '00:00';
clearInterval(clockInterval);
clockInterval = setInterval(function() {
searchSeconds++;
const mins = String(Math.floor(searchSeconds / 60)).padStart(2, '0');
const secs = String(searchSeconds % 60).padStart(2, '0');
searchTimerText.textContent = mins + ':' + secs;
}, 1000);
} else {
clearInterval(clockInterval);
queueView.classList.remove('active');
idleView.style.display = 'block';
}
}
function addMessage(text, type) {
const div = document.createElement('div');
div.className = 'msg ' + type;
div.textContent = text;
messagesEl.appendChild(div);
messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setChatEnabled(enabled) {
msgInput.disabled = !enabled;
btnSend.disabled = !enabled;
if (!enabled) msgInput.value = '';
}
async function apiGet(path, params = {}) {
const query = new URLSearchParams({ id: myId, t: Date.now(), ...params }).toString();
const res = await fetch(path + '?' + query);
return res.json();
}
async function apiPost(path, body = {}) {
const res = await fetch(path, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ id: myId, ...body })
});
return res.json();
}
async function pollLoop() {
try {
const data = await apiGet('/api/poll');
if (!isConnected) {
isConnected = true;
connDot.classList.add('connected');
statusEl.textContent = 'Нажмите «Найти / Далее»';
}
onlineCountEl.textContent = data.online;
for (const ev of data.events) {
await handleEvent(ev);
}
} catch (e) {
isConnected = false;
connDot.classList.remove('connected');
statusEl.textContent = 'Ожидание ответа сервера...';
}
setTimeout(pollLoop, 800);
}
async function handleEvent(data) {
if (data.type === 'waiting') {
showQueueWindow(true);
addMessage('Ожидание свободного собеседника...', 'sys');
} else if (data.type === 'partner_found') {
showQueueWindow(false);
statusEl.textContent = 'Собеседник на связи!';
messagesEl.innerHTML = '';
addMessage('Соединение установлено. Поздоровайтесь!', 'sys');
partnerAvatar.classList.add('speaking');
setChatEnabled(true);
createPeerConnection();
if (data.initiator) {
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
await apiPost('/api/signal', { signal: { type: 'offer', offer } });
}
} else if (data.type === 'signal') {
if (!pc) return;
const sig = data.signal;
if (sig.type === 'offer') {
await pc.setRemoteDescription(new RTCSessionDescription(sig.offer));
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);
await apiPost('/api/signal', { signal: { type: 'answer', answer } });
} else if (sig.type === 'answer') {
await pc.setRemoteDescription(new RTCSessionDescription(sig.answer));
} else if (sig.type === 'candidate') {
try { await pc.addIceCandidate(new RTCIceCandidate(sig.candidate)); } catch (e) {}
}
} else if (data.type === 'chat_message') {
addMessage(data.text, 'partner');
} else if (data.type === 'partner_disconnected') {
closeCall();
statusEl.textContent = 'Собеседник отключился';
addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
}
}
pollLoop();
async function tryInitAudio() {
if (localStream) return;
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
try {
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
btnMute.disabled = false;
} catch (err) {
addMessage('Доступ к микрофону закрыт — доступен только текст', 'sys');
}
}
function createPeerConnection() {
pc = new RTCPeerConnection(rtcConfig);
if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
pc.ontrack = function(event) {
const remoteStream = new MediaStream();
remoteStream.addTrack(event.track);
remoteAudio.srcObject = remoteStream;
remoteAudio.play().catch(() => {});
};
pc.onicecandidate = function(event) {
if (event.candidate) {
apiPost('/api/signal', { signal: { type: 'candidate', candidate: event.candidate } });
}
};
}
function closeCall() {
showQueueWindow(false);
partnerAvatar.classList.remove('speaking');
if (pc) { try { pc.close(); } catch (e) {} pc = null; }
remoteAudio.srcObject = null;
setChatEnabled(false);
}
btnNext.onclick = async function() {
closeCall();
messagesEl.innerHTML = '';
btnStop.disabled = false;
showQueueWindow(true);
tryInitAudio();
await apiGet('/api/find');
};
btnStop.onclick = async function() {
closeCall();
await apiGet('/api/stop');
btnStop.disabled = true;
statusEl.textContent = 'Поиск остановлен';
addMessage('Вы завершили диалог', 'sys');
};
btnMute.onclick = function() {
if (!localStream) return;
isMuted = !isMuted;
localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
btnMute.textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
btnMute.classList.toggle('muted', isMuted);
};
chatForm.onsubmit = async function(e) {
e.preventDefault();
const text = msgInput.value.trim();
if (!text) return;
addMessage(text, 'me');
msgInput.value = '';
await apiGet('/api/chat', { text });
};


`;
app.get('/bg', (req, res) => {
const names = ['bg.png', 'bg.jpg', 'bg.jpeg', 'bg.webp'];
for (const name of names) {
const rootFile = path.join(__dirname, name);
if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
}
res.status(404).end();
});
app.get('/api/poll', (req, res) => {
const id = req.query.id;
if (!id) return res.status(400).end();
const u = ensureUser(id);
const events = u.events.splice(0, u.events.length);
res.json({ online: users.size, events });
});
app.get('/api/find', (req, res) => {
const id = req.query.id;
if (!id) return res.status(400).end();
ensureUser(id);
disconnectPartner(id);
removeFromQueue(id);
waitingQueue = waitingQueue.filter(cid => users.has(cid) && cid !== id);
if (waitingQueue.length > 0) {
const partnerId = waitingQueue.shift();
pairs.set(id, partnerId);
pairs.set(partnerId, id);
pushEvent(id, { type: 'partner_found', initiator: true });
pushEvent(partnerId, { type: 'partner_found', initiator: false });
} else {
waitingQueue.push(id);
pushEvent(id, { type: 'waiting' });
}
res.json({ ok: true });
});
app.post('/api/signal', (req, res) => {
const { id, signal } = req.body || {};
const partnerId = pairs.get(id);
if (partnerId && signal) pushEvent(partnerId, { type: 'signal', signal });
res.json({ ok: true });
});
app.get('/api/chat', (req, res) => {
const { id, text } = req.query;
const partnerId = pairs.get(id);
if (partnerId && typeof text === 'string') {
pushEvent(partnerId, { type: 'chat_message', text: text.slice(0, 500) });
}
res.json({ ok: true });
});
app.get('/api/stop', (req, res) => {
const id = req.query.id;
if (id) {
removeFromQueue(id);
disconnectPartner(id);
}
res.json({ ok: true });
});
app.get('*', (req, res) => {
res.send(HTML_PAGE);
});
app.listen(PORT, '0.0.0.0', () => {
console.log('Likodopt запущен на порту ' + PORT);
});
