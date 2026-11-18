import { joinRoom } from 'https://jsdelivr.net';

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
if (cookieBanner) {
    if (!getCookie('likodopt_cookie_closed')) cookieBanner.classList.add('show');
    document.getElementById('closeCookieBtn').onclick = function() {
        setCookie('likodopt_cookie_closed', '1', 30);
        cookieBanner.classList.remove('show');
    };
}

const idleView = document.getElementById('idleView');
const queueView = document.getElementById('queueView');
const searchTimerText = document.getElementById('searchTimerText');
const statusEl = document.getElementById('status');
const netStatusEl = document.getElementById('netStatus');
const partnerAvatar = document.getElementById('partnerAvatar');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const msgInput = document.getElementById('msgInput');
const btnSend = document.getElementById('btnSend');
const btnNext = document.getElementById('btnNext');
const btnStop = document.getElementById('btnStop');
const btnMute = document.getElementById('btnMute');
const remoteAudio = document.getElementById('remoteAudio');

const myId = 'u_' + Math.random().toString(36).slice(2, 10);
let state = 'idle'; // idle | searching | connected
let partnerPeerId = null;
let localStream = null;
let isMuted = false;
let clockInterval = null;
let searchSeconds = 0;
let searchLoop = null;

// Подключаемся к общей P2P-комнате через стандартные WSS-трекеры (порт 443)
const room = joinRoom({
    appId: 'likodopt_ru_voice_roulette_2026',
    rtcConfig: {
        iceServers: [
            { urls: 'stun:://google.com' },
            { urls: 'stun:://google.com' },
            { urls: 'stun:://cloudflare.com' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
    }
}, 'global_lobby');

const [sendSignal, onSignal] = room.makeAction('sig');
const [sendChat, onChat] = room.makeAction('chat');

netStatusEl.textContent = 'Онлайн: В сети';

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

function onConnected(peerId) {
    if (state === 'connected') return;
    clearInterval(searchLoop);
    state = 'connected';
    partnerPeerId = peerId;
    showQueueWindow(false);
    statusEl.textContent = 'Собеседник на связи!';
    messagesEl.innerHTML = '';
    addMessage('Соединение установлено! Поздоровайтесь 👋', 'sys');
    partnerAvatar.classList.add('speaking');
    setChatEnabled(true);

    if (localStream) {
        room.addStream(localStream, partnerPeerId);
    }
}

// Получение голоса от собеседника
room.onPeerStream((stream, peerId) => {
    if (peerId === partnerPeerId || state === 'searching') {
        onConnected(peerId);
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(() => {});
    }
});

// Обработка поиска пары
onSignal((data, peerId) => {
    if (!data) return;

    if (data.type === 'seek' && state === 'searching') {
        if (myId > data.uid) {
            onConnected(peerId);
            sendSignal({ type: 'accept', uid: myId }, peerId);
        }
    } else if (data.type === 'accept' && state === 'searching') {
        onConnected(peerId);
    } else if (data.type === 'bye' && peerId === partnerPeerId) {
        closeCall(false);
        statusEl.textContent = 'Собеседник отключился';
        addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
    }
});

// Получение текстовых сообщений
onChat((text, peerId) => {
    if (peerId === partnerPeerId && typeof text === 'string') {
        addMessage(text, 'partner');
    }
});

// Если собеседник закрыл вкладку
room.onPeerLeave((peerId) => {
    if (peerId === partnerPeerId) {
        closeCall(false);
        statusEl.textContent = 'Собеседник отключился';
        addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
    }
});

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

function closeCall(notify = true) {
    clearInterval(searchLoop);
    showQueueWindow(false);
    if (notify && partnerPeerId) {
        sendSignal({ type: 'bye' }, partnerPeerId);
    }
    if (localStream && partnerPeerId) {
        try { room.removeStream(localStream, partnerPeerId); } catch (e) {}
    }
    partnerPeerId = null;
    state = 'idle';
    partnerAvatar.classList.remove('speaking');
    setChatEnabled(false);
    remoteAudio.srcObject = null;
}

btnNext.onclick = async function() {
    closeCall(true);
    await tryInitAudio();

    state = 'searching';
    btnStop.disabled = false;
    messagesEl.innerHTML = '';
    showQueueWindow(true);
    addMessage('Ищем свободного собеседника...', 'sys');

    sendSignal({ type: 'seek', uid: myId });
    searchLoop = setInterval(() => {
        if (state === 'searching') {
            sendSignal({ type: 'seek', uid: myId });
        }
    }, 1500);
};

btnStop.onclick = function() {
    closeCall(true);
    btnStop.disabled = true;
    statusEl.textContent = 'Поиск остановлен';
    addMessage('Вы вышли из очереди', 'sys');
};

btnMute.onclick = function() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    btnMute.textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
    btnMute.classList.toggle('muted', isMuted);
};

chatForm.onsubmit = function(e) {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || state !== 'connected' || !partnerPeerId) return;
    addMessage(text, 'me');
    sendChat(text, partnerPeerId);
    msgInput.value = '';
};
