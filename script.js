// 1. Сначала сразу включаем кликабельность всех кнопок и плашки Cookie
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
const closeCookieBtn = document.getElementById('closeCookieBtn');
if (cookieBanner && closeCookieBtn) {
    if (!getCookie('likodopt_cookie_closed')) cookieBanner.classList.add('show');
    closeCookieBtn.onclick = function() {
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

const DB_URL = 'https://kvdb.io';
const myId = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36).slice(-4);

let partnerId = null;
let state = 'idle'; // idle | searching | connecting | connected
let localStream = null;
let pc = null;
let isMuted = false;
let searchTimer = null;
let clockInterval = null;
let secondsCounter = 0;
const processedIds = new Set();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:://google.com' },
        { urls: 'stun:://google.com' },
        { urls: 'stun:://cloudflare.com' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

function setScreen(mode) {
    clearInterval(clockInterval);
    if (idleView) idleView.style.display = 'none';
    if (queueView) queueView.classList.remove('active');
    if (callView) callView.classList.remove('active');

    if (mode === 'queue' && queueView) {
        queueView.classList.add('active');
        secondsCounter = 0;
        if (searchTimerText) searchTimerText.textContent = '00:00';
        clockInterval = setInterval(function() {
            secondsCounter++;
            const m = String(Math.floor(secondsCounter / 60)).padStart(2, '0');
            const s = String(secondsCounter % 60).padStart(2, '0');
            if (searchTimerText) searchTimerText.textContent = m + ':' + s;
        }, 1000);
    } else if (mode === 'call' && callView) {
        callView.classList.add('active');
        secondsCounter = 0;
        if (callTimerText) callTimerText.textContent = '00:00';
        clockInterval = setInterval(function() {
            secondsCounter++;
            const m = String(Math.floor(secondsCounter / 60)).padStart(2, '0');
            const s = String(secondsCounter % 60).padStart(2, '0');
            if (callTimerText) callTimerText.textContent = m + ':' + s;
        }, 1000);
    } else if (idleView) {
        idleView.style.display = 'block';
    }
}

function addMessage(text, type) {
    if (!messagesEl) return;
    const div = document.createElement('div');
    div.className = 'msg ' + type;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setChatEnabled(enabled) {
    if (msgInput) {
        msgInput.disabled = !enabled;
        if (!enabled) msgInput.value = '';
    }
    if (btnSend) btnSend.disabled = !enabled;
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
    const fresh = Array.isArray(current) ? current.filter(m => Date.now() - m.ts < 20000) : [];
    fresh.push({ msgId, from: myId, ts: Date.now(), ...payload });
    await kvSet('in_' + target, fresh.slice(-20));
}

async function checkQueue() {
    if (state !== 'searching') return;
    const now = Date.now();
    let list = (await kvGet('queue_ru')) || [];
    if (!Array.isArray(list)) list = [];
    list = list.filter(item => item && item.id && item.id !== myId && (now - item.ts < 10000));

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
        if (netStatusEl) netStatusEl.textContent = 'Онлайн: В сети';
        if (Array.isArray(messages) && messages.length > 0) {
            await kvSet('in_' + myId, []);
            for (const msg of messages) {
                if (!msg || !msg.msgId || processedIds.has(msg.msgId)) continue;
                processedIds.add(msg.msgId);
                await handleIncomingData(msg);
            }
        }
    } catch (e) {}
    setTimeout(pollInbox, 900);
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
            if (statusEl) statusEl.textContent = 'Собеседник отключился';
            addMessage('Собеседник покинул комнату. Нажмите «Найти / Далее»', 'sys');
        }
    }
}

function tryInitAudio() {
    if (localStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(function(stream) {
            localStream = stream;
            if (btnMute) btnMute.disabled = false;
        })
        .catch(function() {
            addMessage('Доступ к микрофону закрыт — доступен только текст', 'sys');
        });
}

function onCallEstablished() {
    if (state === 'connected') return;
    state = 'connected';
    setScreen('call');
    if (messagesEl) messagesEl.innerHTML = '';
    addMessage('Собеседник найден! Вы в комнате общения 👋', 'sys');
    setChatEnabled(true);
}

async function startWebRTC(isInitiator) {
    setScreen('call');
    if (messagesEl) messagesEl.innerHTML = '';
    addMessage('Соединяем с собеседником...', 'sys');
    setChatEnabled(true);

    pc = new RTCPeerConnection(rtcConfig);
    if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.ontrack = function(ev) {
        const stream = new MediaStream();
        stream.addTrack(ev.track);
        if (remoteAudio) {
            remoteAudio.srcObject = stream;
            remoteAudio.play().catch(() => {});
        }
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

function closeCall(notify = true) {
    clearInterval(searchTimer);
    setScreen('idle');
    if (notify && partnerId) {
        sendSignal(partnerId, { type: 'bye' });
    }
partnerId = null;
state = 'idle';
setChatEnabled(false);
if (pc) {
try { pc.close(); } catch (e) {}
pc = null;
}
if (remoteAudio) remoteAudio.srcObject = null;
}
// Назначаем обработчики кликов сразу и напрямую
if (btnNext) {
btnNext.onclick = function() {
closeCall(true);
tryInitAudio();
state = 'searching';
if (btnStop) btnStop.disabled = false;
if (messagesEl) messagesEl.innerHTML = '';
setScreen('queue');
addMessage('Ищем свободного собеседника...', 'sys');
checkQueue();
searchTimer = setInterval(checkQueue, 1500);
};
}
if (btnStop) {
btnStop.onclick = function() {
closeCall(true);
btnStop.disabled = true;
if (statusEl) statusEl.textContent = 'Диалог завершён';
addMessage('Вы вышли из комнаты общения', 'sys');
};
}
if (btnMute) {
btnMute.onclick = function() {
if (!localStream) return;
isMuted = !isMuted;
localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
btnMute.textContent = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
btnMute.classList.toggle('muted', isMuted);
};
}
if (chatForm) {
chatForm.onsubmit = function(e) {
e.preventDefault();
if (!msgInput) return;
const text = msgInput.value.trim();
if (!text || !partnerId) return;
addMessage(text, 'me');
sendSignal(partnerId, { type: 'chat', text });
msgInput.value = '';
};
}
pollInbox();
