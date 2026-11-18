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

const ROOM_URL = 'https://ntfy.sh';
const myId = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36).slice(-4);

let partnerId = null;
let state = 'idle'; // idle | searching | connecting | connected
let localStream = null;
let pc = null;
let isMuted = false;
let searchTimer = null;
let clockInterval = null;
let searchSeconds = 0;
let eventSource = null;
const processedEvents = new Set();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:://google.com' },
        { urls: 'stun:://google.com' },
        { urls: 'stun:://google.com' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
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

async function sendSignal(payload) {
    const msgId = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    try {
        await fetch(ROOM_URL, {
            method: 'POST',
            body: JSON.stringify({ msgId, from: myId, ts: Date.now(), ...payload })
        });
    } catch (e) {
        netStatusEl.textContent = 'Ошибка сети';
    }
}

function connectStream() {
    if (eventSource) {
        try { eventSource.close(); } catch (e) {}
    }

    // Подключаемся к живому потоку без старых сообщений
    eventSource = new EventSource(ROOM_URL + '/sse?since=none');

    eventSource.onopen = function() {
        netStatusEl.textContent = 'Онлайн: В сети';
    };

    eventSource.onmessage = async function(ev) {
        let wrapper, data;
        try {
            wrapper = JSON.parse(ev.data);
            if (!wrapper.message) return;
            data = JSON.parse(wrapper.message);
        } catch (e) { return; }

        if (!data || data.from === myId) return;
        if (data.msgId && processedEvents.has(data.msgId)) return;
        if (data.msgId) processedEvents.add(data.msgId);

        // Защита от устаревших сообщений старше 15 секунд
        if (data.ts && (Date.now() - data.ts > 15000)) return;

        await handleIncomingData(data);
    };

    eventSource.onerror = function() {
        netStatusEl.textContent = 'Переподключение...';
    };
}

async function handleIncomingData(data) {
    // 1. Кто-то ищет собеседника, и мы тоже в поиске
    if (data.type === 'seek' && state === 'searching') {
        if (myId > data.from) {
            state = 'connecting';
            partnerId = data.from;
            clearInterval(searchTimer);
            await sendSignal({ to: partnerId, type: 'accept' });
            await startWebRTC(true);
        }
    }
    // 2. Нас выбрали в пару
    else if (data.to === myId && data.type === 'accept' && state === 'searching') {
        state = 'connecting';
        partnerId = data.from;
        clearInterval(searchTimer);
        await startWebRTC(false);
    }
    // 3. Сообщения от нашего текущего собеседника
    else if (data.to === myId && data.from === partnerId) {
        if (data.type === 'offer' && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({ to: partnerId, type: 'answer', answer });
            onCallEstablished();
        } else if (data.type === 'answer' && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            onCallEstablished();
        } else if (data.type === 'candidate' && pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
        } else if (data.type === 'chat') {
            addMessage(data.text, 'partner');
        } else if (data.type === 'bye') {
            closeCall(false);
            statusEl.textContent = 'Собеседник отключился';
            addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
        }
    }
}

connectStream();

async function tryInitAudio() {
    if (localStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addMessage('Микрофон недоступен — работает текстовый чат', 'sys');
        return;
    }
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        btnMute.disabled = false;
    } catch (err) {
        addMessage('Доступ к микрофону закрыт — доступен только текст', 'sys');
    }
}

function onCallEstablished() {
    if (state === 'connected') return;
    state = 'connected';
    showQueueWindow(false);
    statusEl.textContent = 'Собеседник на связи!';
    messagesEl.innerHTML = '';
    addMessage('Собеседник найден! Поздоровайтесь 👋', 'sys');
    partnerAvatar.classList.add('speaking');
    setChatEnabled(true);
}

async function startWebRTC(isInitiator) {
    showQueueWindow(false);
    statusEl.textContent = 'Соединяем с собеседником...';

    pc = new RTCPeerConnection(rtcConfig);
    if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.ontrack = function(ev) {
        const stream = new MediaStream();
        stream.addTrack(ev.track);
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(() => {});
        onCallEstablished();
    };

    pc.onicecandidate = function(ev) {
        if (ev.candidate && partnerId) {
            sendSignal({ to: partnerId, type: 'candidate', candidate: ev.candidate });
        }
    };

    pc.onconnectionstatechange = function() {
        if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'completed')) {
            onCallEstablished();
        }
    };

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal({ to: partnerId, type: 'offer', offer });
    }
}

function closeCall(notifyPartner = true) {
    clearInterval(searchTimer);
    showQueueWindow(false);
    if (notifyPartner && partnerId) {
        sendSignal({ to: partnerId, type: 'bye' });
    }
    partnerId = null;
    state = 'idle';
    partnerAvatar.classList.remove('speaking');
    setChatEnabled(false);
    if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
    }
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

    sendSignal({ type: 'seek' });
    searchTimer = setInterval(function() {
        if (state === 'searching') {
            sendSignal({ type: 'seek' });
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
if (!text || state !== 'connected' || !partnerId) return;
addMessage(text, 'me');
sendSignal({ to: partnerId, type: 'chat', text });
msgInput.value = '';
};
