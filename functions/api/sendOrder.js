'use strict';

/**
 * POST /api/sendOrder
 *
 * Принимает заказ от app.js, ПЕРЕСЧИТЫВАЕТ цены на сервере (клиентским суммам не доверяем),
 * формирует чек, отправляет его в Telegram и (опционально) в Google Sheets.
 *
 * Переменные окружения (Cloudflare Pages: Settings, Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID   — id чата/группы/канала, куда приходят заказы
 *   GOOGLE_SHEET_URL   — (необязательно) URL веб-приложения Google Apps Script
 */

/* ---------- Каталог и правила (зеркало клиентских, цены в копейках) ---------- */
// variants — размеры/объёмы с ценой; extras — доступные добавки.
// Должно совпадать с MENU_ITEMS в app.js.
const byn = (value) => Math.round(value * 100);
const WEIGHTS = { s: '200 г', m: '300 г', l: '400 г', xl: '500 г' };
const sizes = (prices) => Object.fromEntries(
  ['s', 'm', 'l', 'xl'].slice(0, prices.length).map((id, i) => [id, { label: id.toUpperCase(), weight: WEIGHTS[id], price: byn(prices[i]) }]),
);
const single = (price) => ({ std: { label: '', weight: '', price: byn(price) } });
const volumes = (p03, p05) => ({ v03: { label: '0,3 л', weight: '', price: byn(p03) }, v05: { label: '0,5 л', weight: '', price: byn(p05) } });
const EXTRA_IDS = ['extra-cheese', 'jalapeno', 'double-meat', 'no-onion'];

const CATALOG = {
  'shawarma-classic': { name: 'Шаурма классическая', variants: sizes([8.9, 11.5, 13.9, 16.5]), extras: EXTRA_IDS },
  'shawarma-cheese': { name: 'Шаурма сырная', variants: sizes([9.9, 12.9, 15.2]), extras: EXTRA_IDS },
  'shawarma-bbq': { name: 'Шаурма барбекю', variants: sizes([10.5, 13.5, 15.9]), extras: EXTRA_IDS },
  'shawarma-village': { name: 'Шаурма деревенская', variants: sizes([10.5, 13.5, 15.9]), extras: EXTRA_IDS },
  'shawarma-hawaii': { name: 'Шаурма гавайская', variants: sizes([10.2, 13.2, 15.5]), extras: EXTRA_IDS },
  'shawarma-caesar': { name: 'Шаурма Цезарь', variants: sizes([10.2, 13.2, 15.5]), extras: EXTRA_IDS },
  'shawarma-grill': { name: 'Шаурма гриль', variants: sizes([10.5, 13.5, 15.9]), extras: EXTRA_IDS },
  'combo-classic': { name: 'Классическое комбо', variants: single(16.9), extras: [] },
  'combo-village': { name: 'Деревенское комбо', variants: single(17.9), extras: [] },
  'pita-korean': { name: 'Пита корейская', variants: single(11.9), extras: EXTRA_IDS },
  'pita-hunter': { name: 'Пита охотничья', variants: single(12.5), extras: EXTRA_IDS },
  fries: { name: 'Картофель фри', variants: single(5.5), extras: [] },
  nuggets: { name: 'Наггетсы куриные', variants: single(7.9), extras: [] },
  'potato-village': { name: 'Картофель по-деревенски', variants: single(6.2), extras: [] },
  'sauce-garlic': { name: 'Соус чесночный', variants: single(1.5), extras: [] },
  'sauce-tomato': { name: 'Соус томатный', variants: single(1.5), extras: [] },
  'sauce-cheese': { name: 'Соус сырный', variants: single(1.5), extras: [] },
  'tea-lemon': { name: 'Чай Lipton черный лимон', variants: single(3.5), extras: [] },
  'tea-peach': { name: 'Чай Lipton персик', variants: single(3.5), extras: [] },
  'lemonade-tarragon': { name: 'Лимонад тархун-киви', variants: volumes(3.5, 4.5), extras: [] },
  'shake-strawberry': { name: 'Молочный коктейль клубничный', variants: volumes(4.5, 5.8), extras: [] },
  'shake-chocolate': { name: 'Молочный коктейль шоколадный', variants: volumes(4.5, 5.8), extras: [] },
  'water-still': { name: 'Вода питьевая негазированная', variants: single(2.3), extras: [] },
};
const EXTRAS = {
  'extra-cheese': { label: 'Доп. сыр', price: 150 },
  jalapeno: { label: 'Халапеньо', price: 100 },
  'double-meat': { label: 'Двойное мясо', price: 400 },
  'no-onion': { label: 'Без лука', price: 0 },
};
const PAYMENTS = {
  'card-courier': { delivery: 'Картой курьеру', pickup: 'Картой при получении' },
  cash: { delivery: 'Наличными курьеру', pickup: 'Наличными при получении' },
  qr: { both: 'Оплата по QR' },
};
const LOCATIONS = {
  nemiga: 'ул. Немига, 5',
  nezavisimosti: 'пр-т Независимости, 44',
};
const PROMOS = { MINSK10: 10 };

const PICKUP_DISCOUNT_PERCENT = 10;
const FREE_DELIVERY_FROM = 2500;
const DELIVERY_FEE = 300;
const MAX_QTY = 20;
const MAX_ITEMS = 30;
const MAX_BODY_BYTES = 20 * 1024;
const REQUEST_TIMEOUT_MS = 7000;
const TELEGRAM_LIMIT = 4000;

/* ---------- Утилиты ---------- */
class ValidationError extends Error {}

const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const money = (cents) => (cents / 100).toFixed(2);
const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

function minskParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Minsk',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return parts;
}

function makeOrderNumber(date) {
  const p = minskParts(date);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `OL-${p.year.slice(2)}${p.month}${p.day}-${suffix}`;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let national = null;
  if (digits.length === 12 && digits.startsWith('375')) national = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith('80')) national = digits.slice(2);
  else if (digits.length === 9) national = digits;
  if (!national || !/^(25|29|33|44)\d{7}$/.test(national)) return null;
  return `+375 (${national.slice(0, 2)}) ${national.slice(2, 5)}-${national.slice(5, 7)}-${national.slice(7, 9)}`;
}

/* ---------- Валидация и расчёт ---------- */
function buildOrder(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Некорректный запрос.');

  const delivery = input.delivery === 'pickup' || input.delivery === 'delivery' ? input.delivery : null;
  if (!delivery) throw new ValidationError('Выберите способ получения.');
  const pickup = delivery === 'pickup';

  const name = clean(input.name, 60);
  if (name.length < 2) throw new ValidationError('Укажите имя.');

  const phone = normalizePhone(input.phone);
  if (!phone) throw new ValidationError('Укажите белорусский номер телефона в формате +375 (29) 123-45-67.');

  let address = '';
  let place = '';
  if (pickup) {
    place = own(LOCATIONS, input.pickupPoint) || '';
    if (!place) throw new ValidationError('Выберите точку самовывоза.');
  } else {
    address = clean(input.address, 200);
    if (address.length < 5) throw new ValidationError('Укажите адрес доставки.');
    place = own(LOCATIONS, input.location) || '';
  }

  const paymentDef = own(PAYMENTS, input.payment);
  if (!paymentDef) throw new ValidationError('Выберите способ оплаты.');
  const payment = paymentDef[delivery] || paymentDef.both;

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
    throw new ValidationError('Корзина пуста или содержит слишком много позиций.');
  }

  const lines = input.items.map((raw) => {
    const product = own(CATALOG, raw && raw.id);
    if (!product) throw new ValidationError('В заказе есть неизвестная позиция. Обновите страницу и повторите.');
    const qty = raw.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new ValidationError('Некорректное количество.');

    // Вариант (размер/объём) должен существовать у этой позиции; цену берём из каталога.
    const variant = own(product.variants, raw.size);
    if (!variant) throw new ValidationError('Некорректный размер блюда. Обновите страницу и повторите.');
    const labelled = Object.keys(product.variants).length > 1;

    const extraKeys = Array.isArray(raw.extras) ? [...new Set(raw.extras)] : [];
    const extras = extraKeys.map((k) => {
      const extra = product.extras.includes(k) ? own(EXTRAS, k) : undefined;
      if (!extra) throw new ValidationError('В заказе есть недоступная добавка. Обновите страницу и повторите.');
      return extra;
    });
    const unit = variant.price + extras.reduce((s, e) => s + e.price, 0);
    return { name: product.name, sizeLabel: labelled ? [variant.label, variant.weight].filter(Boolean).join(' ') : '', extras: extras.map((e) => e.label), qty, unit, sum: unit * qty };
  });

  const subtotal = lines.reduce((s, l) => s + l.sum, 0);

  // Скидки не суммируются: самовывоз −10% ИЛИ промокод −10% (при доставке).
  const promoCode = clean(input.promo, 20).toUpperCase();
  const promoPercent = own(PROMOS, promoCode);
  let discount = 0;
  let discountLabel = '';
  let promoNote = '—';
  if (pickup) {
    discount = Math.round((subtotal * PICKUP_DISCOUNT_PERCENT) / 100);
    discountLabel = `Скидка за самовывоз −${PICKUP_DISCOUNT_PERCENT}%`;
    if (promoPercent) promoNote = `${promoCode} (не суммируется со скидкой за самовывоз)`;
  } else if (promoPercent) {
    discount = Math.round((subtotal * promoPercent) / 100);
    discountLabel = `Промокод ${promoCode} −${promoPercent}%`;
    promoNote = `${promoCode} (−${promoPercent}%)`;
  }

  const deliveryFee = !pickup && subtotal < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
  const total = subtotal - discount + deliveryFee;

  return {
    delivery, pickup, name, phone, address, place, payment, lines,
    subtotal, discount, discountLabel, deliveryFee, total, promoNote,
    comment: clean(input.comment, 300),
  };
}

/* ---------- Чек ---------- */
function formatReceipt(order, orderNumber, date) {
  const p = minskParts(date);
  const when = `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;

  const items = order.lines.map((l, idx) => {
    const size = l.sizeLabel ? ` (${escapeHtml(l.sizeLabel)})` : '';
    const head = `${idx + 1}. ${escapeHtml(l.name)}${size} × ${l.qty} — ${money(l.sum)} BYN`;
    return l.extras.length ? `${head}\n    + ${escapeHtml(l.extras.join(', '))}` : head;
  });

  const rows = [`Товары: ${money(order.subtotal)} BYN`];
  if (order.discount > 0) rows.push(`${escapeHtml(order.discountLabel)}: −${money(order.discount)} BYN`);
  rows.push(order.pickup ? 'Доставка: самовывоз' : `Доставка: ${order.deliveryFee ? `${money(order.deliveryFee)} BYN` : 'бесплатно'}`);

  const lines = [
    `<b>FIRE SHAWARMA — новый заказ ${orderNumber}</b>`,
    `Время: ${when} (Минск)`,
    '',
    '<b>Состав заказа</b>',
    ...items,
    '',
    ...rows,
    `<b>Итого к оплате: ${money(order.total)} BYN</b>`,
    '',
    order.pickup
      ? `<b>Самовывоз:</b> ${escapeHtml(order.place)}`
      : `<b>Доставка:</b> ${escapeHtml(order.address)}${order.place ? `\nГотовит точка: ${escapeHtml(order.place)}` : ''}`,
    `Оплата: ${escapeHtml(order.payment)}`,
    `Промокод: ${escapeHtml(order.promoNote)}`,
    '',
    `Клиент: ${escapeHtml(order.name)}`,
    `Телефон: ${escapeHtml(order.phone)}`,
  ];
  if (order.comment) lines.push(`Комментарий: ${escapeHtml(order.comment)}`);

  const text = lines.join('\n');
  return text.length > TELEGRAM_LIMIT ? `${text.slice(0, TELEGRAM_LIMIT - 1)}…` : text;
}

function sheetPayload(order, orderNumber, date) {
  const p = minskParts(date);
  return {
    orderNumber,
    createdAt: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,
    type: order.pickup ? 'Самовывоз' : 'Доставка',
    place: order.pickup ? order.place : order.address,
    kitchen: order.place,
    name: order.name,
    phone: order.phone,
    payment: order.payment,
    promo: order.promoNote === '—' ? '' : order.promoNote,
    comment: order.comment,
    items: order.lines.map((l) => `${l.name}${l.sizeLabel ? ` (${l.sizeLabel})` : ''}${l.extras.length ? ` + ${l.extras.join(', ')}` : ''} × ${l.qty}`).join('; '),
    itemsList: order.lines.map((l) => ({ name: l.name, size: l.sizeLabel, extras: l.extras, qty: l.qty, unitPrice: money(l.unit), sum: money(l.sum) })),
    subtotal: money(order.subtotal),
    discount: money(order.discount),
    deliveryFee: money(order.deliveryFee),
    total: money(order.total),
    currency: 'BYN',
    // Поля в формате, который ожидает google-apps-script.js
    deliveryType: order.pickup ? 'Самовывоз' : 'Доставка',
    address: order.pickup ? order.place : order.address,
    itemsText: order.lines.map((l) => `${l.name}${l.sizeLabel ? ` (${l.sizeLabel})` : ''}${l.extras.length ? ` + ${l.extras.join(', ')}` : ''} × ${l.qty}`).join('; '),
    paymentMethod: order.payment,
    promoCode: order.promoNote === '—' ? '' : order.promoNote,
  };
}

/* ---------- Отправка ---------- */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(token, chatId, text) {
  const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    throw new Error(`Telegram API ${res.status}: ${(data && data.description) || 'нет ответа'}`);
  }
}

async function sendSheet(url, payload) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Google Sheet webhook ${res.status}`);
}

/* ---------- Handler ---------- */
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Метод не поддерживается.' }, { Allow: 'POST' });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'Слишком большой запрос.' });
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch (_) {
    return json(400, { ok: false, error: 'Некорректный запрос.' });
  }

  let order;
  try {
    order = buildOrder(input);
  } catch (err) {
    if (err instanceof ValidationError) return json(400, { ok: false, error: err.message });
    console.error('buildOrder failed:', err.message);
    return json(500, { ok: false, error: 'Внутренняя ошибка. Попробуйте ещё раз.' });
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const sheetUrl = env.GOOGLE_SHEET_URL;
  const telegramReady = Boolean(token && chatId);
  const sheetReady = Boolean(sheetUrl && /^https:\/\//i.test(sheetUrl));

  if (!telegramReady && !sheetReady) {
    console.error('Не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID и GOOGLE_SHEET_URL.');
    return json(500, { ok: false, error: 'Приём заказов временно не настроен. Позвоните нам: +375 (29) 777-88-99.' });
  }

  const now = new Date();
  const orderNumber = makeOrderNumber(now);

  const tasks = [];
  if (telegramReady) tasks.push(['Telegram', sendTelegram(token, chatId, formatReceipt(order, orderNumber, now))]);
  if (sheetReady) tasks.push(['Google Sheet', sendSheet(sheetUrl, sheetPayload(order, orderNumber, now))]);

  const results = await Promise.allSettled(tasks.map(([, promise]) => promise));
  let delivered = false;
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') delivered = true;
    else console.error(`${tasks[i][0]} failed for ${orderNumber}:`, result.reason && result.reason.message);
  });

  if (!delivered) {
    return json(502, { ok: false, error: 'Не удалось передать заказ в работу. Позвоните нам: +375 (29) 777-88-99.' });
  }

  return json(200, { ok: true, orderNumber, total: money(order.total) });
}
