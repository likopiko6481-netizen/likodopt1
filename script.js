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
const callView = document.getElementById('callView');
const searchTimerText = document.getElementById('searchTimerText');
const callTimerText = document.getElementById('callTimerText');
const statusEl = document.getElementById('status');
const netStatusEl = document.getElementById('netStatus');
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
let secondsCounter = 0;
let searchLoop = null;

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

// Переключение экранов: 'idle' | 'queue' | 'call'
function setScreen(mode) {
    clearInterval(clockInterval);
    idleView.style.display = 'none';
    queueView.classList.remove('active');
    callView.classList.remove('active');

    if (mode === 'queue') {
        queueView.classList.add('active');
        secondsCounter = 0;
        searchTimerText.textContent = '00:00';
        clockInterval = setInterval(() => {
            secondsCounter++;
            const m = String(Math.floor(secondsCounter / 60)).padStart(2, '0');
            const s = String(secondsCounter % 60).padStart(2, '0');
            searchTimerText.textContent = m + ':' + s;
        }, 1000);
    } else if (mode === 'call') {
        callView.classList.add('active');
        secondsCounter = 0;
        callTimerText.textContent = '00:00';
        clockInterval = setInterval(() => {
            secondsCounter++;
            const m = String(Math.floor(secondsCounter / 60)).padStart(2, '0');
            const s = String(secondsCounter % 60).padStart(2, '0');
            callTimerText.textContent = m + ':' + s;
        }, 1000);
    } else {
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
    setScreen('call');
    messagesEl.innerHTML = '';
    addMessage('Собеседник найден! Вы в комнате общения 👋', 'sys');
    setChatEnabled(true);

    if (localStream) {
        room.addStream(localStream, partnerPeerId);
    }
}

room.onPeerStream((stream, peerId) => {
    if (peerId === partnerPeerId || state === 'searching') {
        onConnected(peerId);
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(() => {});
    }
});

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
        addMessage('Собеседник покинул комнату. Нажмите «Найти / Далее»', 'sys');
    }
});

onChat((text, peerId) => {
    if (peerId === partnerPeerId && typeof text === 'string') {
        addMessage(text, 'partner');
    }
});

room.onPeerLeave((peerId) => {
    if (peerId === partnerPeerId) {
        closeCall(false);
        statusEl.textContent = 'Собеседник отключился';
        addMessage('Собеседник покинул комнату. Нажмите «Найти / Далее»', 'sys');
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
    setScreen('idle');
    if (notify && partnerPeerId) {
        sendSignal({ type: 'bye' }, partnerPeerId);
    }
    if (localStream && partnerPeerId) {
        try { room.removeStream(localStream, partnerPeerId); } catch (e) {}
    }
    partnerPeerId = null;
    state = 'idle';
    setChatEnabled(false);
    remoteAudio.srcObject = null;
}

btnNext.onclick = async function() {
    closeCall(true);
    await tryInitAudio();

    state = 'searching';
    btnStop.disabled = false;
    messagesEl.innerHTML = '';
    setScreen('queue');
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
    statusEl.textContent = 'Диалог завершён';
    addMessage('Вы вышли из комнаты общения', 'sys');
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
