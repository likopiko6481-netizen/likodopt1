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

const SLOT_PREFIX = 'likodopt_ru_slot_';
const MAX_SLOTS = 15;

let peer = null;
let currentCall = null;
let dataConn = null;
let localStream = null;
let isMuted = false;
let state = 'idle'; // idle | searching | connected
let clockInterval = null;
let searchSeconds = 0;

const peerConfig = {
    host: '://peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    config: {
        iceServers: [
            { urls: 'stun:://google.com' },
            { urls: 'stun:://google.com' },
            { urls: 'stun:://cloudflare.com' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
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

function onConnected() {
    if (state === 'connected') return;
    state = 'connected';
    showQueueWindow(false);
    statusEl.textContent = 'Собеседник на связи!';
    messagesEl.innerHTML = '';
    addMessage('Соединение установлено! Поздоровайтесь 👋', 'sys');
    partnerAvatar.classList.add('speaking');
    setChatEnabled(true);
}

function bindDataConn(conn) {
    dataConn = conn;
    conn.on('open', onConnected);
    conn.on('data', function(text) {
        if (typeof text === 'string') addMessage(text, 'partner');
    });
    conn.on('close', function() {
        if (state === 'connected') {
            closeAll();
            statusEl.textContent = 'Собеседник отключился';
            addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
        }
    });
}

function bindMediaCall(call) {
    currentCall = call;
    call.on('stream', function(remoteStream) {
        onConnected();
        remoteAudio.srcObject = remoteStream;
        remoteAudio.play().catch(() => {});
    });
    call.on('close', function() {
        if (state === 'connected') {
            closeAll();
            statusEl.textContent = 'Собеседник отключился';
            addMessage('Собеседник покинул чат. Нажмите «Далее»', 'sys');
        }
    });
}

function closeAll() {
    state = 'idle';
    showQueueWindow(false);
    partnerAvatar.classList.remove('speaking');
    setChatEnabled(false);

    if (currentCall) { try { currentCall.close(); } catch (e) {} currentCall = null; }
    if (dataConn) { try { dataConn.close(); } catch (e) {} dataConn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    remoteAudio.srcObject = null;
}

// Ищем занятую ячейку, чтобы позвонить, или занимаем свободную
function trySlot(slotNum) {
    if (state !== 'searching') return;

    if (slotNum > MAX_SLOTS) {
        // Если все ячейки заняты — создаем случайную и ждем
        createWaitingPeer(SLOT_PREFIX + Math.floor(Math.random() * MAX_SLOTS + 1));
        return;
    }

    const targetSlotId = SLOT_PREFIX + slotNum;
    const tempPeer = new Peer(peerConfig);

    tempPeer.on('open', function() {
        const conn = tempPeer.connect(targetSlotId, { reliable: true });
        let answered = false;

        const timeout = setTimeout(function() {
            if (!answered && state === 'searching') {
                // Никто не ответил в этой ячейке — значит она свободна! Занимаем её
                try { tempPeer.destroy(); } catch (e) {}
                createWaitingPeer(targetSlotId);
            }
        }, 1200);

        conn.on('open', function() {
            answered = true;
            clearTimeout(timeout);
            peer = tempPeer;
            bindDataConn(conn);
            if (localStream) {
                const call = peer.call(targetSlotId, localStream);
                if (call) bindMediaCall(call);
            }
        });

        conn.on('error', function() {
            if (!answered && state === 'searching') {
                answered = true;
                clearTimeout(timeout);
                try { tempPeer.destroy(); } catch (e) {}
                createWaitingPeer(targetSlotId);
            }
        });
    });

    tempPeer.on('error', function() {
        if (state === 'searching') {
            try { tempPeer.destroy(); } catch (e) {}
            trySlot(slotNum + 1);
        }
    });
}

function createWaitingPeer(slotId) {
    if (state !== 'searching') return;
    peer = new Peer(slotId, peerConfig);

    peer.on('open', function() {
        netStatusEl.textContent = 'Онлайн: В сети';
    });

    peer.on('connection', function(incomingConn) {
        if (state !== 'searching') {
            incomingConn.close();
            return;
        }
        bindDataConn(incomingConn);
    });

    peer.on('call', function(incomingCall) {
        if (state !== 'searching' && state !== 'connected') {
            incomingCall.close();
            return;
        }
        incomingCall.answer(localStream || undefined);
        bindMediaCall(incomingCall);
    });

    peer.on('error', function(err) {
        if (err.type === 'unavailable-id' && state === 'searching') {
            // Пока мы занимали ячейку, её успел занять другой — пробуем следующую
            try { peer.destroy(); } catch (e) {}
            trySlot(Math.floor(Math.random() * MAX_SLOTS) + 1);
        }
    });
}

btnNext.onclick = async function() {
    closeAll();
    await tryInitAudio();

    state = 'searching';
    btnStop.disabled = false;
    messagesEl.innerHTML = '';
    showQueueWindow(true);
    addMessage('Ищем свободного собеседника...', 'sys');

    trySlot(1);
};

btnStop.onclick = function() {
    closeAll();
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
    if (!text || state !== 'connected' || !dataConn || !dataConn.open) return;
    addMessage(text, 'me');
    dataConn.send(text);
    msgInput.value = '';
};

window.addEventListener('beforeunload', closeAll);
