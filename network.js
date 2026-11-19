// =========================================================================
// ОТДЕЛЬНЫЙ ПРОТОКОЛ ПОДКЛЮЧЕНИЯ СОБЕСЕДНИКОВ (LIKODOPT SIGNALING PROTOCOL)
// =========================================================================

const SUPABASE_URL = 'ВСТАВЬТЕ_ВАШ_PROJECT_URL';
const SUPABASE_ANON_KEY = 'ВСТАВЬТЕ_ВАШ_ANON_KEY';

window.LikodoptNet = (function () {
  const myId = 'u_' + Math.random().toString(36).slice(2, 9);
  const myName = 'Участник #' + Math.floor(100 + Math.random() * 899);
  const sessionNonce = Math.floor(100000 + Math.random() * 900000).toString();

  let ws = null;
  let heartbeatTimer = null;
  let isConnected = false;
  let callbacks = {};
  const seenPackets = new Set();

  // Формирование стандартного пакета протокола
  function buildPacket(cmd, targetId, payload) {
    return {
      cmd: cmd,               // 'connect' | 'wait_solo' | 'wait_group' | 'pair' | 'comm' | 'bye'
      uco: myId,              // Уникальный ID узла
      name: myName,           // Отображаемое имя
      to: targetId || '*',    // Адресат ('*' — всем в лобби, либо ID собеседника)
      session: '1',
      nonce: sessionNonce + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      data: payload || {},
      ts: Date.now()
    };
  }

  // Отправка пакета в канал
  function send(cmd, targetId, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const packet = buildPacket(cmd, targetId, payload);
    const frame = {
      topic: 'realtime:likodopt_room_v1',
      event: 'broadcast',
      payload: {
        type: 'broadcast',
        event: 'sig',
        payload: packet
      },
      ref: String(Date.now())
    };
    try {
      ws.send(JSON.stringify(frame));
    } catch (e) {}
  }

  // Подключение к транспортному серверу
  function init(handlers) {
    callbacks = handlers || {};

    if (!SUPABASE_URL.startsWith('http') || SUPABASE_ANON_KEY.includes('ВСТАВЬТЕ')) {
      if (callbacks.onStatus) callbacks.onStatus('Ожидание ключей Supabase');
      return;
    }

    const wsHost = SUPABASE_URL.replace('https://', '').replace('http://', '').replace(/\/$/, '');
    const wsUrl = `wss://${wsHost}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = function () {
        isConnected = true;
        if (callbacks.onStatus) callbacks.onStatus('Онлайн: В сети');

        // Вход в общий канал сигнализации
        ws.send(JSON.stringify({
          topic: 'realtime:likodopt_room_v1',
          event: 'phx_join',
          payload: { config: { broadcast: { self: false } } },
          ref: '1'
        }));

        send('connect', '*', { status: 'ready' });

        // Поддержание активного соединения (Heartbeat)
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(function () {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
          }
        }, 25000);
      };

      ws.onmessage = function (event) {
        let frame = null;
        try { frame = JSON.parse(event.data); } catch (e) { return; }
        if (!frame || frame.event !== 'broadcast' || !frame.payload || !frame.payload.payload) return;

        const pkt = frame.payload.payload;
        if (!pkt || pkt.uco === myId || seenPackets.has(pkt.nonce)) return;
        seenPackets.add(pkt.nonce);

        // Фильтрация чужих личных пакетов
        if (pkt.to !== '*' && pkt.to !== myId) return;

        if (callbacks.onPacket) callbacks.onPacket(pkt);
      };

      ws.onclose = function () {
        isConnected = false;
        clearInterval(heartbeatTimer);
        if (callbacks.onStatus) callbacks.onStatus('Переподключение...');
        setTimeout(function () { init(callbacks); }, 2500);
      };

      ws.onerror = function () {};
    } catch (e) {}
  }

  return {
    myId: myId,
    myName: myName,
    init: init,
    send: send,
    isReady: function () { return isConnected; }
  };
})();
