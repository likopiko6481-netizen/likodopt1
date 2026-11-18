const DB_URL = 'https://kvdb.io';

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

const myId = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36).slice(-4);

let partnerId = null;
let state = 'idle';
let localStream = null;
let pc = null;
let isMuted = false;
let searchTimer = null;
let clockInterval = null;
let searchSeconds = 0;
let inboxBuffer = [];
const processedIds = new Set();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:://google.com' },
        { urls: 'stun:://google.com' },
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

async function kvGet(key) {
    try {
        const res = await fetch(DB_URL + '/' + key + '?t=' + Date.now());
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function kvSet(key, data) {
    try {
        await fetch(DB_URL + '/' + key, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    } catch (e) {}
}

async function sendSignal(target, payload) {
    const msgId = myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const current = (await kvGet('in_' + target)) || [];
    const fresh = current.filter(m => Date.now() - m.ts < 15000);
    fresh.push({ msgId, from: myId, ts: Date.now(), ...payload });
    await kvSet('in_' + target, fresh.slice(-15));
}

async function checkQueue() {
    if (state !== 'searching') return;
    const now = Date.now();
    let list = (await kvGet('queue_ru')) || [];
    list = list.filter(item => item && item.id !== myId && (now - item.ts < 9000));

    if (list.length > 0) {
        const candidate = list[0];
        if (myId > candidate.id) {
            state = 'connecting';
            partnerId = candidate.id;
            clearInterval(searchTimer);
            await kvSet('queue_ru', list.slice(1));
            await sendSignal(partnerId, { type: 'accept' });
            await startWebRTC(true);
            return;
        }
    }

    list.push({ id: myId, ts: now });
    await kvSet('queue_ru', list);
}

async function pollInbox() {
    try {
        const messages = await kvGet('in_' + myId);
        netStatusEl.textContent = 'Онлайн: В сети';
        if (Array.isArray(messages) && messages.length > 0) {
            await kvSet('in_' + myId, []);
            for (const msg of messages) {
                if (!msg || !msg.msgId || processedIds.has(msg.msgId)) continue;
                processedIds.add(msg.msgId);
                await handleIncomingData(msg);
            }
        }
    } catch (e) {}
    setTimeout(pollInbox, 1000);
}

async function handleIncomingData(data) {
    if (!data || data.from === myId) return;

    if (data.type === 'accept' && state === 'searching') {
        state = 'connecting';
        partnerId = data.from;
        clearInterval(searchTimer);
        await startWebRTC(false);
    } else if (data.from === partnerId) {
        if (data.type === 'offer' && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal(partnerId, { type: 'answer', answer });
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

pollInbox();

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
            sendSignal(partnerId, { type: 'candidate', candidate: ev.candidate });
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
        await sendSignal(partnerId, { type: 'offer', offer });
    }
}

function closeCall(notifyPartner = true) {
    clearInterval(searchTimer);
    showQueueWindow(false);
    if (notifyPartner && partnerId) {
        sendSignal(partnerId, { type: 'bye' });
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
    tryInitAudio();

    state = 'searching';
    btnStop.disabled = false;
    messagesEl.innerHTML = '';
    showQueueWindow(true);
    addMessage('Ищем свободного собеседника...', 'sys');

    checkQueue();
    searchTimer = setInterval(checkQueue, 1800);
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

chatForm.onsubmit = async function(e) {
    e.preventDefault();
    const text = msgInput.value.trim();
if (!text || state !== 'connected' || !partnerId) return;
addMessage(text, 'me');
sendSignal(partnerId, { type: 'chat', text });
msgInput.value = '';
};
