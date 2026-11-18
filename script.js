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

const TOPIC = 'likodopt_ru_room_7741';
const myId = 'u_' + Math.random().toString(36).slice(2, 10);

let partnerId = null;
let state = 'idle';
let localStream = null;
let pc = null;
let isMuted = false;
let searchTimer = null;
let clockInterval = null;
let searchSeconds = 0;
let lastMsgId = '';

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

async function sendSignal(payload) {
    try {
        await fetch('https://ntfy.sh' + TOPIC, {
            method: 'POST',
            body: JSON.stringify({ from: myId, ts: Date.now(), ...payload })
        });
    } catch (e) {}
}

async function pollMessages() {
    try {
        const url = 'https://ntfy.sh' + TOPIC + '/json?poll=1&since=10s' + (lastMsgId ? '&id=' + lastMsgId : '');
        const res = await fetch(url);
        if (res.ok) {
            netStatusEl.textContent = 'Онлайн: В сети';
            const text = await res.text();
            const lines = text.trim().split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (!lines[i]) continue;
                const wrapper = JSON.parse(lines[i]);
                if (wrapper.id) lastMsgId = wrapper.id;
                if (!wrapper.message) continue;
                const data = JSON.parse(wrapper.message);
                await processSignal(data);
            }
        }
    } catch (e) {
        netStatusEl.textContent = 'Сеть (проверьте VPN)';
    }
    setTimeout(pollMessages, 1200);
}

async function processSignal(data) {
    if (!data || data.from === myId) return;
    if (data.type === 'seek' && state === 'searching') {
        if (myId > data.from) {
            await startCallWith(data.from, true);
            sendSignal({ to: data.from, type: 'accept' });
        }
    } else if (data.to === myId) {
        if (data.type === 'accept' && state === 'searching') {
            await startCallWith(data.from, false);
        } else if (data.from === partnerId) {
            if (data.type === 'signal') await handleWebRTC(data.signal);
            else if (data.type === 'chat') addMessage(data.text, 'partner');
            else if (data.type === 'bye') {
                closeCall();
                statusEl.textContent = 'Собеседник отключился';
                addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
            }
        }
    }
}

pollMessages();

async function tryInitAudio() {
    if (localStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addMessage('Микрофон недоступен — работает текстовый чат', 'sys');
        return;
    }
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        btnMute.disabled = false;
        addMessage('Микрофон подключен', 'sys');
    } catch (err) {
        addMessage('Доступ к микрофону закрыт — доступен только текст', 'sys');
    }
}

function closeCall() {
    clearInterval(searchTimer);
    showQueueWindow(false);
    if (partnerId) sendSignal({ to: partnerId, type: 'bye' });
    partnerId = null;
    state = 'idle';
    partnerAvatar.classList.remove('speaking');
    setChatEnabled(false);
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    remoteAudio.srcObject = null;
}

async function startCallWith(target, isInitiator) {
    clearInterval(searchTimer);
    showQueueWindow(false);
    partnerId = target;
    state = 'connected';
    statusEl.textContent = 'Собеседник на связи!';
    messagesEl.innerHTML = '';
    addMessage('Соединение установлено. Поздоровайтесь!', 'sys');
    partnerAvatar.classList.add('speaking');
    setChatEnabled(true);

    pc = new RTCPeerConnection(rtcConfig);
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = function(ev) {
        const stream = new MediaStream();
        stream.addTrack(ev.track);
        remoteAudio.srcObject = stream;
        remoteAudio.play().catch(() => {});
    };

    pc.onicecandidate = function(ev) {
        if (ev.candidate) sendSignal({ to: partnerId, type: 'signal', signal: { candidate: ev.candidate } });
    };

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ to: partnerId, type: 'signal', signal: { offer } });
    }
}

async function handleWebRTC(sig) {
    if (!pc) return;
    if (sig.offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(sig.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ to: partnerId, type: 'signal', signal: { answer } });
    } else if (sig.answer) {
        await pc.setRemoteDescription(new RTCSessionDescription(sig.answer));
    } else if (sig.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
    }
}

btnNext.onclick = function() {
    closeCall();
    state = 'searching';
    btnStop.disabled = false;
    messagesEl.innerHTML = '';
    showQueueWindow(true);
    addMessage('Вы вошли в очередь поиска собеседника...', 'sys');
    tryInitAudio();
    sendSignal({ type: 'seek' });
    searchTimer = setInterval(function() {
        if (state === 'searching') sendSignal({ type: 'seek' });
    }, 1800);
};

btnStop.onclick = function() {
    closeCall();
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
