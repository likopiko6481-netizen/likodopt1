const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

const activePeers = new Map();
const chatMessages = [];
const activeChatUsers = new Set();

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Likodopt — Голосовая чат-рулетка</title>
    <script src="https://unpkg.com"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
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
            background: rgba(24, 27, 34, 0.88);
            backdrop-filter: blur(8px);
            width: 100%;
            max-width: 460px;
            border-radius: 20px;
            padding: 25px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            border: 1px solid #262a35;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .logo {
            font-size: 1.5rem;
            font-weight: 800;
            color: #00e676;
            letter-spacing: 1px;
        }
        .online-badge {
            background: #232834;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            color: #a0aab8;
            display: flex;
            align-items: center;
        }
        .online-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #ff5252;
            border-radius: 50%;
            margin-right: 6px;
            transition: background 0.3s;
        }
        .online-dot.connected {
            background: #00e676;
        }
        .voice-box {
            background: rgba(18, 20, 26, 0.8);
            border-radius: 16px;
            padding: 25px 15px;
            text-align: center;
            margin-bottom: 15px;
            border: 1px solid #222630;
        }
        .avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: #232834;
            margin: 0 auto 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            transition: box-shadow 0.15s ease;
        }
        .avatar.speaking {
            box-shadow: 0 0 0 6px rgba(0, 230, 118, 0.35);
            background: #1c382c;
        }
        #status {
            font-size: 1rem;
            color: #cfd8e3;
            font-weight: 500;
        }
        .chat-box {
            background: rgba(18, 20, 26, 0.8);
            border-radius: 14px;
            height: 180px;
            display: flex;
            flex-direction: column;
            margin-bottom: 15px;
            border: 1px solid #222630;
            overflow: hidden;
        }
        #messages {
            flex: 1;
            padding: 12px;
            overflow-y: auto;
            font-size: 0.9rem;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .msg { padding: 8px 12px; border-radius: 10px; max-width: 82%; word-wrap: break-word; }
        .msg.me { background: #00e676; color: #000; align-self: flex-end; font-weight: 500; }
        .msg.partner { background: #262b38; color: #fff; align-self: flex-start; }
        .msg.sys { background: transparent; color: #788292; align-self: center; font-size: 0.8rem; text-align: center; }
        .chat-input {
            display: flex;
            border-top: 1px solid #222630;
        }
        .chat-input input {
            flex: 1;
            background: transparent;
            border: none;
            padding: 12px;
            color: #fff;
            outline: none;
            font-size: 0.9rem;
        }
        .chat-input button {
            background: transparent;
            border: none;
            color: #00e676;
            font-weight: bold;
            padding: 0 16px;
            cursor: pointer;
        }
        .chat-input button:disabled { color: #555; cursor: not-allowed; }
        .controls {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .btn {
            padding: 14px;
            border: none;
            border-radius: 12px;
            font-size: 1rem;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.1s, opacity 0.2s;
        }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        #btnNext { background: #00e676; color: #000; }
        #btnStop { background: #ff5252; color: #fff; }
        #btnMute {
            grid-column: span 2;
            background: #262b38;
            color: #fff;
            font-weight: 600;
        }
        #btnMute.muted { background: #ff9800; color: #000; }
    </style>
</head>
<body>

<div class="app">
    <div class="header">
        <div class="logo">LIKODOPT</div>
        <div class="online-badge"><span class="online-dot" id="connDot"></span>Онлайн: <span id="onlineCount">0</span></div>
    </div>

    <div class="voice-box">
        <div class="avatar" id="partnerAvatar">🎙️</div>
        <div id="status">Подключение к серверу...</div>
    </div>

    <div class="chat-box">
        <div id="messages"></div>
        <form class="chat-input" id="chatForm">
            <input type="text" id="msgInput" placeholder="Написать сообщение..." disabled autocomplete="off">
            <button type="submit" id="btnSend" disabled>➤</button>
        </form>
    </div>

    <div class="controls">
        <button class="btn" id="btnNext" disabled>Найти / Далее</button>
        <button class="btn" id="btnStop" disabled>Стоп</button>
        <button class="btn" id="btnMute" disabled>Выключить микрофон</button>
    </div>

    <audio id="remoteAudio" autoplay playsinline></audio>
</div>

<script>
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

    let peer = null;
    let myPeerId = null;
    let currentCall = null;
    let dataConn = null;
    let localStream = null;
    let isMuted = false;
    let isSearching = false;
    let searchTimer = null;

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

    function initPeer() {
        const isHttps = window.location.protocol === 'https:';
        peer = new Peer({
            host: window.location.hostname,
            port: window.location.port || (isHttps ? 443 : 80),
            path: '/peerjs',
            key: 'peerjs',
            secure: isHttps,
            config: {
                iceServers: [
                    { urls: 'stun:://google.com' },
                    { urls: 'stun:://google.com' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            }
        });

        peer.on('open', (id) => {
            myPeerId = id;
            connDot.classList.add('connected');
            btnNext.disabled = false;
            statusEl.textContent = 'Нажмите «Найти / Далее»';
            pingServer();
            setInterval(pingServer, 5000);
        });

        peer.on('call', (incomingCall) => {
            if (!isSearching && currentCall) {
                incomingCall.close();
                return;
            }
            stopSearchLoop();
            incomingCall.answer(localStream);
            setupCall(incomingCall);
        });

        peer.on('connection', (incomingConn) => {
            setupData(incomingConn);
        });

        peer.on('disconnected', () => {
            connDot.classList.remove('connected');
            statusEl.textContent = 'Переподключение к серверу...';
            peer.reconnect();
        });

        peer.on('error', (err) => {
            statusEl.textContent = 'Ошибка связи: ' + err.type;
        });
    }

    async function pingServer() {
        if (!myPeerId) return;
        try {
            await fetch('/ping?peerId=' + encodeURIComponent(myPeerId));
const res = await fetch('/online-count');
const data = await res.json();
if (data.count !== undefined) onlineCountEl.textContent = data.count;
} catch (e) {}
}
initPeer();
async function initAudio() {
if (!localStream) {
try {
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
btnMute.disabled = false;
} catch (err) {
statusEl.textContent = 'Разрешите доступ к микрофону в браузере!';
addMessage('Ошибка: браузер заблокировал микрофон', 'sys');
throw err;
}
}
}
function stopSearchLoop() {
isSearching = false;
clearInterval(searchTimer);
}
function closeCall() {
stopSearchLoop();
partnerAvatar.classList.remove('speaking');
setChatEnabled(false);
if (currentCall) { try { currentCall.close(); } catch (e) {} currentCall = null; }
if (dataConn) { try { dataConn.close(); } catch (e) {} dataConn = null; }
remoteAudio.srcObject = null;
}
function onConnected() {
stopSearchLoop();
statusEl.textContent = 'Собеседник на связи!';
messagesEl.innerHTML = '';
addMessage('Соединение установлено. Поздоровайтесь!', 'sys');
partnerAvatar.classList.add('speaking');
setChatEnabled(true);
}
function setupCall(call) {
currentCall = call;
call.on('stream', (remoteStream) => {
onConnected();
remoteAudio.srcObject = remoteStream;
remoteAudio.play().catch(() => {});
});
call.on('close', () => {
closeCall();
statusEl.textContent = 'Собеседник отключился';
addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
});
}
function setupData(conn) {
dataConn = conn;
conn.on('open', onConnected);
conn.on('data', (text) => {
if (typeof text === 'string') addMessage(text, 'partner');
});
conn.on('close', () => {
closeCall();
statusEl.textContent = 'Собеседник отключился';
addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
});
}
async function findPartnerStep() {
if (!isSearching || !myPeerId) return;
try {
const res = await fetch('/find-partner?myId=' + encodeURIComponent(myPeerId));
const data = await res.json();
if (data.partnerId && isSearching) {
stopSearchLoop();
statusEl.textContent = 'Соединение с собеседником...';
const conn = peer.connect(data.partnerId, { reliable: true });
const call = peer.call(data.partnerId, localStream);
setupData(conn);
setupCall(call);
}
} catch (e) {}
}
btnNext.addEventListener('click', async () => {
await initAudio();
closeCall();
isSearching = true;
btnStop.disabled = false;
messagesEl.innerHTML = '';
statusEl.textContent = 'Ищем собеседника...';
addMessage('Ожидание свободного собеседника...', 'sys');
findPartnerStep();
searchTimer = setInterval(findPartnerStep, 2000);
});
btnStop.addEventListener('click', () => {
closeCall();
btnStop.disabled = true;
statusEl.textContent = 'Поиск остановлен';
addMessage('Вы завершили диалог', 'sys');
});
btnMute.addEventListener('click', () => {
if (!localStream) return;
isMuted = !isMuted;
localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
btnMute.textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
btnMute.classList.toggle('muted', isMuted);
});
chatForm.addEventListener('submit', (e) => {
e.preventDefault();
const text = msgInput.value.trim();
if (!text || !dataConn || !dataConn.open) return;
addMessage(text, 'me');
dataConn.send(text);
msgInput.value = '';
});


`;
const server = app.listen(PORT, '0.0.0.0', () => {
console.log('Likodopt Server is running on port ' + PORT);
});
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
activeChatUsers.add(ws);
ws.on('close', () => activeChatUsers.delete(ws));
});
const peerServer = ExpressPeerServer(server, {
path: '/',
proxied: true,
allow_discovery: true,
key: 'peerjs',
concurrent_limit: 1000,
alive_timeout: 60000
});
app.use('/peerjs', peerServer);
peerServer.on('connection', (client) => {
activePeers.set(client.id, Date.now());
});
peerServer.on('disconnect', (client) => {
activePeers.delete(client.id);
});
setInterval(() => {
const now = Date.now();
const timeout = 5 * 60 * 1000;
activePeers.forEach((lastActive, peerId) => {
if (now - lastActive > timeout) activePeers.delete(peerId);
});
}, 5 * 60 * 1000);
app.get('/bg', (req, res) => {
const names = ['bg.png', 'bg.jpg', 'bg.jpeg', 'bg.webp'];
for (const name of names) {
const rootFile = path.join(__dirname, name);
if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
}
res.status(404).end();
});
app.get('/health', (req, res) => {
res.json({
app: 'Likodopt',
status: 'OK',
activePeers: activePeers.size,
uptime: process.uptime()
});
});
app.get('/ping', (req, res) => {
const peerId = req.query.peerId;
if (peerId && activePeers.has(peerId)) {
activePeers.set(peerId, Date.now());
}
res.sendStatus(200);
});
app.get('/online-count', (req, res) => {
res.json({
success: true,
count: activePeers.size,
timestamp: Date.now()
});
});
app.get('/find-partner', (req, res) => {
const myId = req.query.myId;
if (!myId) return res.status(400).json({ error: 'Требуется параметр myId' });
activePeers.set(myId, Date.now());
const availablePeers = [];
const now = Date.now();
activePeers.forEach((lastActive, peerId) => {
if (peerId !== myId && (now - lastActive) < 30000) {
availablePeers.push(peerId);
}
});
if (availablePeers.length === 0) {
return res.json({ error: 'Нет доступных собеседников', code: 'NO_PARTNERS' });
}
const partnerId = availablePeers[Math.floor(Math.random() * availablePeers.length)];
res.json({ partnerId, timestamp: Date.now() });
});
app.get('*', (req, res) => {
res.send(HTML_PAGE);
});
app.use((err, req, res, next) => {
console.error('Server error:', err);
res.status(500).json({ error: 'Internal server error' });
});
