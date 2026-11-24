"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
    let pathname;

    try {
        pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
        res.writeHead(400);
        res.end("Bad request");
        return;
    }

    if (pathname === "/") pathname = "/index.html";

    const filePath = path.resolve(ROOT, "." + pathname);

    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Файл не найден");
            return;
        }

        res.writeHead(200, {
            "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-cache"
        });

        const stream = fs.createReadStream(filePath);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
    });
});

const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 128 * 1024
});

let nextClientId = 1;
let waitingSolo = [];
const rooms = new Map();

function send(ws, type, data = {}) {
    if (ws.readyState === ws.OPEN) {
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
            candidate.readyState === candidate.OPEN &&
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

    // Первый участник ждал. Второй участник создаёт WebRTC-предложение.
    send(partner, "peer-joined", {
        mode: "solo",
        code: room.id,
        peer: publicUser(ws)
    });

    send(ws, "joined", {
        mode: "solo",
        code: room.id,
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

    for (const member of room.members) {
        send(member, "peer-joined", {
            mode: "group",
            code: room.id,
            count: room.members.length + 1,
            peer: publicUser(ws)
        });
    }

    room.members.push(ws);
    ws.room = room;

    send(ws, "joined", {
        mode: "group",
        code: room.id,
        count: room.members.length,
        peers: existingPeers
    });
}

function broadcastOnline() {
    const count = wss.clients.size;

    for (const client of wss.clients) {
        send(client, "online", { count });
    }
}

wss.on("connection", (ws) => {
    ws.clientId = `u${nextClientId++}`;
    ws.nick = `Гость-${String(ws.clientId).replace(/\D/g, "").padStart(4, "0")}`;
    ws.room = null;
    ws.isAlive = true;

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
            const text = String(message.text || "").slice(0, 500);

            if (!room || !text.trim()) return;

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

            const target = room.members.find(
                (member) => member.clientId === String(message.to || "")
            );

            if (!target || target === ws) return;

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

const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }

        ws.isAlive = false;
        ws.ping();
    }
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Likodopt запущен: http://localhost:${PORT}`);
    console.log("Для проверки откройте сайт в двух вкладках или на двух устройствах.");
});
