// Сохраняем анонимную сессию в cookie
let sessionUid = getCookie('likodopt_uid');
if (!sessionUid) {
sessionUid = 'lk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
setCookie('likodopt_uid', sessionUid, 7);
}
// --- Основная логика чат-рулетки ---
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
{ urls: 'stun:google.com' },
{ urls: 'stun:google.com' },
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
setCookie('likodopt_last_peer', id, 1);
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
await fetch('/ping?peerId=' + encodeURIComponent(myPeerId) + '&uid=' + encodeURIComponent(sessionUid));
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
});// Сохраняем анонимную сессию в cookie
let sessionUid = getCookie('likodopt_uid');
if (!sessionUid) {
sessionUid = 'lk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
setCookie('likodopt_uid', sessionUid, 7);
}
// --- Основная логика чат-рулетки ---
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
{ urls: 'stun:google.com' },
{ urls: 'stun:google.com' },
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
setCookie('likodopt_last_peer', id, 1);
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
await fetch('/ping?peerId=' + encodeURIComponent(myPeerId) + '&uid=' + encodeURIComponent(sessionUid));
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
