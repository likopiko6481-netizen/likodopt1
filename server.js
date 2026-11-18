const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 9000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Хранилища данных
const activePeers = new Map();
const chatMessages = [];
const activeChatUsers = new Set();

// Инициализация HTTP сервера
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  Likodopt Server is running:
  - Web: https://onrender.com (port ${PORT})
  - PeerJS: wss://://onrender.com
  - Health: https://onrender.com/health
  `);
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  activeChatUsers.add(ws);
  broadcastOnlineCount();

  // Отправляем историю сообщений
  ws.send(JSON.stringify({
    type: 'history',
    messages: chatMessages.slice(-50)
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'chat_message') {
        const chatMessage = {
          text: data.text,
          timestamp: Date.now(),
          type: 'chat_message'
        };
        
        // Сохраняем сообщение
        chatMessages.push(chatMessage);
        
        // Рассылаем всем клиентам
        broadcastMessage(chatMessage);
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', () => {
    activeChatUsers.delete(ws);
    broadcastOnlineCount();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    activeChatUsers.delete(ws);
    broadcastOnlineCount();
  });
});

// Функция рассылки сообщений
function broadcastMessage(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Функция обновления счетчика онлайн
function broadcastOnlineCount() {
  const count = activeChatUsers.size;
  broadcastMessage({
    type: 'online_count',
    count
  });
}

// Peer Server (на основном порту)
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: true,
  key: 'peerjs',
  concurrent_limit: 1000,
  alive_timeout: 60000
});

app.use('/peerjs', peerServer);

// Обработчики PeerServer
peerServer.on('connection', (client) => {
  const clientId = client.id;
  activePeers.set(clientId, Date.now());
  console.log('Peer connected:', clientId);
});

peerServer.on('disconnect', (client) => {
  const clientId = client.id;
  activePeers.delete(clientId);
  console.log('Peer disconnected:', clientId);
});

// Очистка неактивных пиров
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000;
  
  activePeers.forEach((lastActive, peerId) => {
    if (now - lastActive > timeout) {
      activePeers.delete(peerId);
      console.log(`Removed inactive peer: ${peerId}`);
    }
  });
}, 5 * 60 * 1000);

// Раздача вашей фоновой картинки (bg.png / bg.jpg)
app.get('/bg', (req, res) => {
  const names = ['bg.png', 'bg.jpg', 'bg.jpeg', 'bg.webp'];
  for (const name of names) {
    const publicFile = path.join(__dirname, 'public', name);
    const rootFile = path.join(__dirname, name);
    if (fs.existsSync(publicFile)) return res.sendFile(publicFile);
    if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
  }
  res.status(404).end();
});

// API Endpoints
app.get('/health', (req, res) => {
  res.json({
    app: 'Likodopt',
    status: 'OK',
    activePeers: activePeers.size,
    activeChatUsers: activeChatUsers.size,
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
  try {
    const myId = req.query.myId;
    
    if (!myId) {
      return res.status(400).json({ 
        error: 'Требуется параметр myId',
        code: 'MISSING_ID'
      });
    }

    // Обновляем активность текущего пира
    activePeers.set(myId, Date.now());

    // Ищем доступных партнеров
    const availablePeers = [];
    const now = Date.now();
    const maxInactiveTime = 30000; // 30 секунд

    activePeers.forEach((lastActive, peerId) => {
      if (peerId !== myId && (now - lastActive) < maxInactiveTime) {
        availablePeers.push(peerId);
      }
    });

    if (availablePeers.length === 0) {
      return res.status(200).json({
        error: 'Нет доступных собеседников',
        code: 'NO_PARTNERS',
        retryAfter: 5
      });
    }

    // Выбираем случайного партнера
    const partnerId = availablePeers[Math.floor(Math.random() * availablePeers.length)];
    
    res.json({ 
      partnerId,
      timestamp: Date.now()
    });

  } catch (err) {
    console.error('Ошибка поиска партнера:', err);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      code: 'SERVER_ERROR'
    });
  }
});

// Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
