"use strict";

/**
 * Likodopt — сигнальный сервер (Node.js + ws)
 *
 * Запуск:
 *   npm init -y && npm i ws
 *   node server.js
 *
 * HTTPS (нужен для микрофона на телефоне и по LAN-IP):
 *   TLS_KEY=./certs/key.pem TLS_CERT=./certs/cert.pem node server.js
 *
 * TURN (нужен, когда участники в разных сетях):
 *   TURN_URLS=turn:turn.example.com:3478,TURN_USERNAME=user,TURN_CREDENTIAL=pass
 *   (все три — переменные окружения, а не один аргумент)
 *
 * Прочие переменные: PORT, HOST, STUN_URLS, ICE_TTL
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav"
};

// Отдаём по HTTP только это. Всё остальное — 404.
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME));

// И это не отдаём никогда, даже если расширение разрешено.
const DENIED_FILES = new Set([
    "server.js",
    "package.json",
    "package-lock.json",
    "yarn.lock",
    ".env",
    ".env.local",
    ".gitignore",
    ".npmrc"
]);

const DENIED_DIRS = new Set(["node_modules", "certs", ".git", ".vscode", ".idea"]);

const SIGNAL_WINDOW_MS = 10000;
const SIGNAL_LIMIT = 300;
const PRUNE_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

// ---------------------------------------------------------------------------
// ICE-конфигурация (отдаётся клиенту через /ice-config)
// ---------------------------------------------------------------------------
function splitEnv(name, fallback) {
    const raw = name in process.env ? process.env[name] : fallback;
    return String(raw || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function buildIceConfig() {
    const iceServers = [];

    const stunUrls = splitEnv("STUN_URLS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302");
    if (stunUrls.length) iceServers.push({ urls: stunUrls });

    const turnUrls = splitEnv("TURN_URLS", "");
    if (turnUrls.length) {
        const turn = { urls: turnUrls };
        if (process.env.TURN_USERNAME) turn.username = process.env.TURN_USERNAME;
        if (process.env.TURN_CREDENTIAL) turn.credential = process.env.TURN_CREDENTIAL;
        iceServers.push(turn);
    }

    return {
        iceServers,
        ttl: Number(process.env.ICE_TTL) || 3600
    };
}

const ICE_CONFIG = buildIceConfig();
const HAS_TURN = ICE_CONFIG.iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => String(url).startsWith("turn"));
});

// ---------------------------------------------------------------------------
// HTTP: статика + служебные эндпоинты
// ---------------------------------------------------------------------------
function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store"
    });
    res.end(body);
}

function sendText(res, status, text) {
    res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store"
    });
    res.end(text);
}

function isPathSafe(filePath) {
    return filePath === ROOT || filePath.startsWith(ROOT + path.sep);
}

function isDenied(filePath) {
    const relative = path.relative(ROOT, filePath);
    const parts = relative.split(path.sep);

    if (parts.some((part) => part.startsWith(".") || DENIED_DIRS.has(part))) return true;

    return DENIED_FILES.has(parts[parts.length - 1].toLowerCase());
}

function serveStatic(req, res, pathname) {
    const filePath = path.resolve(ROOT, "." + pathname);

    if (!isPathSafe(filePath) || isDenied(filePath)) {
        sendText(res, 404, "Файл не найден");
        return;
    }

    const extension = path.extname(filePath).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
        sendText(res, 404, "Файл не найден");
        return;
    }

    fs.stat(filePath, (statError, stat) => {
        if (statError || !stat.isFile()) {
            sendText(res, 404, "Файл не найден");
            return;
        }

        res.writeHead(200, {
            "Content-Type": MIME[extension] || "application/octet-stream",
            "Content-Length": stat.size,
            "Cache-Control": "no-cache",
            "Permissions-Policy": "microphone=(self)",
            "X-Content-Type-Options": "nosniff"
        });

        if (req.method === "HEAD") {
            res.end();
            return;
        }

        const stream = fs.createReadStream(filePath);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
    });
}

function handleRequest(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Method not allowed");
        return;
    }

    let pathname;

    try {
        pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
        sendText(res, 400, "Bad request");
        return;
    }

    if (pathname === "/healthz") {
        sendJson(res, 200, {
            ok: true,
            uptime: Math.round(process.uptime()),
            clients: wss ? wss.clients.size : 0,
            rooms: rooms.size,
            turn: HAS_TURN
        });
        return;
    }

    if (pathname === "/ice-config") {
        sendJson(res, 200, ICE_CONFIG);
        return;
    }

    if (pathname === "/") pathname = "/index.html";

    serveStatic(req, res, pathname);
}

// ---------------------------------------------------------------------------
// Транспорт: HTTP или HTTPS (если заданы TLS_KEY / TLS_CERT)
// ---------------------------------------------------------------------------
let server;

if (process.env.TLS_KEY && process.env.TLS_CERT) {
    server = https.createServer(
        {
            key: fs.readFileSync(path.resolve(process.env.TLS_KEY)),
            cert: fs.readFileSync(path.resolve(process.env.TLS_CERT))
        },
        handleRequest
    );
} else {
    server = http.createServer(handleRequest);
}

const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 128 * 1024
});

// ---------------------------------------------------------------------------
// Комнаты и состояние
// ---------------------------------------------------------------------------
let nextClientId = 1;
let waitingSolo = [];
const rooms = new Map();

function send(ws, type, data = {}) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function cleanNick(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20);
}

function publicUser(ws) {
    return {
        id: ws.clientId,
        nick: ws.nick
    };
}

function isAliveSocket(ws) {
    return Boolean(ws) && ws.readyState === WebSocket.OPEN;
}

function makeRoom(mode, maxMembers) {
    const id = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");

    const room = {
        id,
        mode,
        maxMembers,
        members: []
    };

    rooms.set(id, room);
    return room;
}

function removeFromQueue(ws) {
    waitingSolo = waitingSolo.filter((client) => client !== ws);
}

function leaveCurrentRoom(ws) {
    removeFromQueue(ws);

    const room = ws.room;
    if (!room) return;

    ws.room = null;
    room.members = room.members.filter((member) => member !== ws);

    if (room.mode === "solo") {
        for (const member of room.members) {
            member.room = null;
            send(member, "room-closed", {
                reason: "Собеседник покинул разговор."
            });
        }

        room.members = [];
    } else {
        for (const member of room.members) {
            send(member, "peer-left", {
                peerId: ws.clientId,
                count: room.members.length,
                code: room.id
            });
        }
    }

    if (room.members.length === 0) {
        rooms.delete(room.id);
    }
}

function joinSolo(ws) {
    leaveCurrentRoom(ws);

    let partner = null;

    while (waitingSolo.length && !partner) {
        const candidate = waitingSolo.shift();

        if (
            candidate !== ws &&
            isAliveSocket(candidate) &&
            !candidate.room
        ) {
            partner = candidate;
        }
    }

    if (!partner) {
        waitingSolo.push(ws);
        send(ws, "waiting", { mode: "solo" });
        return;
    }

    const room = makeRoom("solo", 2);
    room.members = [partner, ws];
    partner.room = room;
    ws.room = room;

    // Ждавший участник инициирует соединение, пришедший — отвечает.
    // Клиент всё равно использует perfect negotiation, флаг нужен для порядка.
    send(partner, "peer-joined", {
        mode: "solo",
        code: room.id,
        count: 2,
        initiator: false,
        peer: publicUser(ws)
    });

    send(ws, "joined", {
        mode: "solo",
        code: room.id,
        count: 2,
        initiator: true,
        peers: [publicUser(partner)]
    });
}

function joinGroup(ws) {
    leaveCurrentRoom(ws);

    let room = [...rooms.values()].find(
        (item) => item.mode === "group" && item.members.length < item.maxMembers
    );

    if (!room) room = makeRoom("group", 6);

    const existingPeers = room.members.map(publicUser);

    // Сначала добавляем участника в комнату — иначе его сигналы могут
    // прийти от уже подключённых раньше, чем он попадёт в room.members.
    room.members.push(ws);
    ws.room = room;

    for (const member of room.members) {
        if (member === ws) continue;

        send(member, "peer-joined", {
            mode: "group",
            code: room.id,
            count: room.members.length,
            initiator: true,
            peer: publicUser(ws)
        });
    }

    send(ws, "joined", {
        mode: "group",
        code: room.id,
        count: room.members.length,
        initiator: false,
        peers: existingPeers
    });
}

function broadcastOnline() {
    const count = wss.clients.size;

    for (const client of wss.clients) {
        send(client, "online", { count });
    }
}

function allowSignal(ws) {
    const now = Date.now();

    ws.signalTimes = (ws.signalTimes || []).filter((time) => now - time < SIGNAL_WINDOW_MS);
    ws.signalTimes.push(now);

    return ws.signalTimes.length <= SIGNAL_LIMIT;
}

// Чистим мёртвые сокеты: иначе в очереди и комнатах копятся «зомби»,
// с которыми клиент честно пытается установить WebRTC и получает 0/1.
function prune() {
    waitingSolo = waitingSolo.filter((client) => isAliveSocket(client) && !client.room);

    for (const room of [...rooms.values()]) {
        const dead = room.members.filter((member) => !isAliveSocket(member));

        for (const member of dead) {
            member.room = null;
            room.members = room.members.filter((item) => item !== member);

            if (room.mode === "solo") {
                for (const other of room.members) {
                    other.room = null;
                    send(other, "room-closed", { reason: "Собеседник отключился." });
                }
                room.members = [];
            } else {
                for (const other of room.members) {
                    send(other, "peer-left", {
                        peerId: member.clientId,
                        count: room.members.length,
                        code: room.id
                    });
                }
            }
        }

        if (room.members.length === 0) rooms.delete(room.id);
    }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
wss.on("connection", (ws) => {
    ws.clientId = `u${nextClientId++}`;
    ws.nick = `Гость-${String(nextClientId).padStart(4, "0")}`;
    ws.room = null;
    ws.isAlive = true;
    ws.signalTimes = [];

    send(ws, "welcome", { id: ws.clientId });
    broadcastOnline();

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (!message || typeof message.type !== "string") return;

        if (message.type === "nick") {
            const nick = cleanNick(message.nick);
            if (nick.length >= 2) ws.nick = nick;
            return;
        }

        if (message.type === "find") {
            const nick = cleanNick(message.nick);
            if (nick.length >= 2) ws.nick = nick;
            joinSolo(ws);
            return;
        }

        if (message.type === "group") {
            const nick = cleanNick(message.nick);
            if (nick.length >= 2) ws.nick = nick;
            joinGroup(ws);
            return;
        }

        if (message.type === "leave") {
            leaveCurrentRoom(ws);
            send(ws, "left");
            return;
        }

        if (message.type === "chat") {
            const room = ws.room;
            const text = String(message.text || "").slice(0, 500).trim();

            if (!room || !text) return;

            for (const member of room.members) {
                if (member === ws) continue;

                send(member, "chat", {
                    from: ws.clientId,
                    nick: ws.nick,
                    text
                });
            }

            return;
        }

        if (message.type === "signal") {
            const room = ws.room;
            if (!room) return;

            if (!allowSignal(ws)) return;

            const target = room.members.find(
                (member) => member.clientId === String(message.to || "")
            );

            if (!target || target === ws || !isAliveSocket(target)) return;

            send(target, "signal", {
                from: ws.clientId,
                data: message.data
            });
        }
    });

    ws.on("close", () => {
        leaveCurrentRoom(ws);
        broadcastOnline();
    });

    ws.on("error", () => {
        // Событие close выполнит очистку комнаты и очереди.
    });
});

// ---------------------------------------------------------------------------
// Таймеры
// ---------------------------------------------------------------------------
const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }

        ws.isAlive = false;
        ws.ping();
    }
}, HEARTBEAT_INTERVAL_MS);

const pruner = setInterval(prune, PRUNE_INTERVAL_MS);

wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(pruner);
});

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
server.listen(PORT, HOST, () => {
    const scheme = process.env.TLS_KEY && process.env.TLS_CERT ? "https" : "http";

    console.log(`Likodopt запущен: ${scheme}://localhost:${PORT}`);
    console.log(`Комнат: ${rooms.size} · ICE-серверов: ${ICE_CONFIG.iceServers.length}`);

    if (scheme === "http") {
        console.warn("ВНИМАНИЕ: без HTTPS микрофон работает только на localhost.");
        console.warn("Для телефона/LAN-IP задайте TLS_KEY и TLS_CERT или используйте https-туннель.");
    }

    if (!HAS_TURN) {
        console.warn("ВНИМАНИЕ: TURN не настроен (TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL).");
        console.warn("Участники в разных сетях (LTE + домашний Wi-Fi) не соединятся — будет 0/1.");
    }

    console.log("Проверка: откройте сайт в двух вкладках или на двух устройствах.");
});

function shutdown(signal) {
    console.log(`\n${signal}: завершаем работу...`);

    clearInterval(heartbeat);
    clearInterval(pruner);

    for (const ws of wss.clients) {
        try { ws.close(1001, "server shutdown"); } catch {}
    }

    wss.close(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
