/* ==========================================================================
   FIRE SHAWARMA — app.js
   Корзина, кастомизатор блюд, промокод, оформление заказа.
   Деньги везде считаются в копейках (целые числа), в BYN форматируются на выходе.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------- Константы ---------- */
  const STORAGE_KEY = 'fire-shawarma:cart:v3';
  const LOCATION_KEY = 'fire-shawarma:location:v1';
  const ENDPOINT = '/.netlify/functions/sendOrder';
  const FREE_DELIVERY_FROM = 2500; // 25.00 BYN
  const DELIVERY_FEE = 300;        // 3.00 BYN
  const PICKUP_DISCOUNT = 10;      // %
  const PROMO_CODES = { MINSK10: 10 }; // код -> % скидки на блюда
  const MAX_QTY = 20;
  const REQUEST_TIMEOUT_MS = 20000;
  const PHONE_RE = /^(25|29|33|44)\d{7}$/;
  const SHOP_PHONE = '+375 (29) 777-88-99';
  const NETWORK_ERROR = `Не удалось отправить заказ. Проверьте соединение или позвоните нам: ${SHOP_PHONE}.`;

  /* ---------- Меню (источник данных для карточек и корзины) ---------- */
  // Цены в копейках. Фото берутся только из локальной папки ./images (номер файла в поле photo).
  // variants — размеры/объёмы: у каждого свой вес и цена (если вариант один, выбор не показывается).
  // extras   — добавки: если список не пуст, вместо «В корзину» открывается окно выбора.
  // Цены, варианты и добавки дублируются в netlify/functions/sendOrder.js (сервер пересчитывает заказ сам).
  const byn = (value) => Math.round(value * 100);
  const imageSrc = (n) => `./images/${n}.jpg`;

  const EXTRA_IDS = ['extra-cheese', 'jalapeno', 'double-meat', 'no-onion'];

  // Шаурма: S 200 г, M 300 г (по умолчанию), L 400 г; XL 500 г только у классической.
  const sizes = (prices) => ['s', 'm', 'l', 'xl'].slice(0, prices.length).map((id, i) => ({
    id,
    label: id.toUpperCase(),
    weight: `${[200, 300, 400, 500][i]} г`,
    price: byn(prices[i]),
  }));
  const single = (weight, price) => [{ id: 'std', label: '', weight, price: byn(price) }];
  const volumes = (p03, p05) => [
    { id: 'v03', label: '0,3 л', weight: '', price: byn(p03) },
    { id: 'v05', label: '0,5 л', weight: '', price: byn(p05) },
  ];

  const MENU_ITEMS = [
    // --- Шаурма ---
    { id: 'shawarma-classic', category: 'shawarma', name: 'Шаурма классическая', photo: 2, variants: sizes([8.9, 11.5, 13.9, 16.5]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, капуста, помидоры, маринованные огурцы, чесночный соус, лаваш.' },
    { id: 'shawarma-cheese', category: 'shawarma', name: 'Шаурма сырная', photo: 3, variants: sizes([9.9, 12.9, 15.2]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, сыр чеддер, помидоры, свежие огурцы, сырный соус, лаваш.' },
    { id: 'shawarma-bbq', category: 'shawarma', name: 'Шаурма барбекю', photo: 4, variants: sizes([10.5, 13.5, 15.9]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, бекон, маринованные огурцы, красный лук, соус барбекю, лаваш.' },
    { id: 'shawarma-village', category: 'shawarma', name: 'Шаурма деревенская', photo: 5, variants: sizes([10.5, 13.5, 15.9]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, картофель по-деревенски, маринованные огурцы, жареный лук, чесночный соус, лаваш.' },
    { id: 'shawarma-hawaii', category: 'shawarma', name: 'Шаурма гавайская', photo: 6, variants: sizes([10.2, 13.2, 15.5]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, ананас, сыр чеддер, салат айсберг, сливочный соус, лаваш.' },
    { id: 'shawarma-caesar', category: 'shawarma', name: 'Шаурма Цезарь', isNew: true, photo: 7, variants: sizes([10.2, 13.2, 15.5]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица, салат айсберг, помидоры, пармезан, соус Цезарь, лаваш.' },
    { id: 'shawarma-grill', category: 'shawarma', name: 'Шаурма гриль', isNew: true, photo: 8, variants: sizes([10.5, 13.5, 15.9]), defaultVariant: 'm', extras: EXTRA_IDS,
      description: 'Курица гриль, помидоры, красный лук, маринованные огурцы, томатный и чесночный соусы, лаваш.' },

    // --- Комбо ---
    { id: 'combo-classic', category: 'combo', name: 'Классическое комбо', photo: 9, variants: single('650 г', 16.9), defaultVariant: 'std', extras: [],
      description: 'Шаурма классическая 300 г, картофель фри, кетчуп, напиток.' },
    { id: 'combo-village', category: 'combo', name: 'Деревенское комбо', photo: 10, variants: single('700 г', 17.9), defaultVariant: 'std', extras: [],
      description: 'Шаурма деревенская 400 г, картофель фри, напиток.' },

    // --- Пита ---
    { id: 'pita-korean', category: 'pita', name: 'Пита корейская', isNew: true, photo: 11, variants: single('400 г', 11.9), defaultVariant: 'std', extras: EXTRA_IDS,
      description: 'Курица, морковь по-корейски, свежие огурцы, помидоры, чесночный соус, пита.' },
    { id: 'pita-hunter', category: 'pita', name: 'Пита охотничья', isNew: true, photo: 12, variants: single('400 г', 12.5), defaultVariant: 'std', extras: EXTRA_IDS,
      description: 'Курица, лук, маринованные огурцы, салат айсберг, помидоры, соус барбекю, пита.' },

    // --- Закуски ---
    { id: 'fries', category: 'snacks', name: 'Картофель фри', photo: 13, variants: single('150 г', 5.5), defaultVariant: 'std', extras: [],
      description: 'Картофель фри, соль.' },
    { id: 'nuggets', category: 'snacks', name: 'Наггетсы куриные', photo: 14, variants: single('180 г', 7.9), defaultVariant: 'std', extras: [],
      description: 'Куриное филе в панировке, 9 шт.' },
    { id: 'potato-village', category: 'snacks', name: 'Картофель по-деревенски', photo: 15, variants: single('160 г', 6.2), defaultVariant: 'std', extras: [],
      description: 'Картофельные дольки со специями.' },

    // --- Соусы (без описаний) ---
    { id: 'sauce-garlic', category: 'sauces', name: 'Соус чесночный', photo: 16, variants: single('30 г', 1.5), defaultVariant: 'std', extras: [], description: '' },
    { id: 'sauce-tomato', category: 'sauces', name: 'Соус томатный', photo: 17, variants: single('30 г', 1.5), defaultVariant: 'std', extras: [], description: '' },
    { id: 'sauce-cheese', category: 'sauces', name: 'Соус сырный', photo: 18, variants: single('30 г', 1.5), defaultVariant: 'std', extras: [], description: '' },

    // --- Напитки (без описаний) ---
    { id: 'tea-lemon', category: 'drinks', name: 'Чай Lipton черный лимон', photo: 19, variants: single('0,5 л', 3.5), defaultVariant: 'std', extras: [], description: '' },
    { id: 'tea-peach', category: 'drinks', name: 'Чай Lipton персик', photo: 20, variants: single('0,5 л', 3.5), defaultVariant: 'std', extras: [], description: '' },
    { id: 'lemonade-tarragon', category: 'drinks', name: 'Лимонад тархун-киви', photo: 21, variants: volumes(3.5, 4.5), defaultVariant: 'v05', extras: [], description: '' },
    { id: 'shake-strawberry', category: 'drinks', name: 'Молочный коктейль клубничный', photo: 22, variants: volumes(4.5, 5.8), defaultVariant: 'v05', extras: [], description: '' },
    { id: 'shake-chocolate', category: 'drinks', name: 'Молочный коктейль шоколадный', photo: 23, variants: volumes(4.5, 5.8), defaultVariant: 'v05', extras: [], description: '' },
    { id: 'water-still', category: 'drinks', name: 'Вода питьевая негазированная', photo: 24, variants: single('0,5 л', 2.3), defaultVariant: 'std', extras: [], description: '' },
  ];

  /* ---------- Утилиты ---------- */
  const $ = (id) => document.getElementById(id);
  const money = (cents) => (cents / 100).toFixed(2);
  const toCents = (value) => Math.round(parseFloat(String(value).replace(',', '.')) * 100) || 0;

  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch (_) { /* приватный режим */ } },
  };

  /* ---------- Состояние ---------- */
  const state = {
    items: [],        // { key, id, name, image, weight, size, sizeLabel, extras[], unitPrice, qty }
    promo: null,      // 'MINSK10' | null
    mode: 'delivery', // 'delivery' | 'pickup'
  };
  let promoError = null;
  let submitting = false;

  function isValidItem(i) {
    return i && typeof i === 'object'
      && typeof i.key === 'string' && typeof i.id === 'string'
      && typeof i.name === 'string' && typeof i.image === 'string' && typeof i.weight === 'string'
      && typeof i.size === 'string' && typeof i.sizeLabel === 'string'
      && Array.isArray(i.extras)
      && i.extras.every((e) => e && typeof e.value === 'string' && typeof e.name === 'string')
      && Number.isInteger(i.unitPrice) && i.unitPrice >= 0
      && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= MAX_QTY;
  }

  // Строка корзины должна ссылаться на существующую позицию и вариант меню
  function inCatalog(line) {
    const item = MENU_ITEMS.find((m) => m.id === line.id);
    return Boolean(item && item.variants.some((v) => v.id === line.size)
      && line.extras.every((e) => item.extras.includes(e.value)));
  }

  function loadState() {
    const raw = store.get(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data.items)) state.items = data.items.filter((i) => isValidItem(i) && inCatalog(i));
      if (typeof data.promo === 'string' && Object.prototype.hasOwnProperty.call(PROMO_CODES, data.promo)) {
        state.promo = data.promo;
      }
    } catch (_) { /* битые данные — начинаем с пустой корзины */ }
  }

  function saveState() {
    store.set(STORAGE_KEY, JSON.stringify({ items: state.items, promo: state.promo }));
  }

  /* ---------- Расчёт ---------- */
  function calculate() {
    const subtotal = state.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
    const count = state.items.reduce((sum, i) => sum + i.qty, 0);
    const pickup = state.mode === 'pickup';

    // Скидки не суммируются: самовывоз −10% ИЛИ промокод −10% (при доставке).
    let discount = 0;
    let discountLabel = '';
    if (subtotal > 0) {
      if (pickup) {
        discount = Math.round((subtotal * PICKUP_DISCOUNT) / 100);
        discountLabel = `Скидка за самовывоз −${PICKUP_DISCOUNT}%`;
      } else if (state.promo) {
        const percent = PROMO_CODES[state.promo];
        discount = Math.round((subtotal * percent) / 100);
        discountLabel = `Промокод ${state.promo} −${percent}%`;
      }
    }

    const delivery = !pickup && subtotal > 0 && subtotal < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
    const total = subtotal - discount + delivery;
    return { subtotal, count, pickup, discount, discountLabel, delivery, total };
  }

  /* ---------- DOM-ссылки ---------- */
  const el = {
    modal: $('dish-modal'),
    drawer: $('cart-drawer'),
    drawerPanel: $('drawer-panel'),
    cartCount: $('cart-count'),
    floatCount: $('floating-count'),
    floatTotal: $('floating-total'),
    cartOpen: $('cart-open'),
    cartList: $('cart-list'),
    cartEmpty: $('cart-empty'),
    cartTemplate: $('cart-item-template'),
    progress: $('delivery-progress'),
    progressText: $('progress-text'),
    progressTrack: $('progress-track'),
    progressBar: $('progress-bar'),
    totalItems: $('total-items'),
    totalDelivery: $('total-delivery'),
    discountRow: $('discount-row'),
    discountLabel: $('discount-label'),
    totalDiscount: $('total-discount'),
    totalGrand: $('total-grand'),
    form: $('checkout-form'),
    submit: $('checkout-submit'),
    formError: $('checkout-error'),
    name: $('order-name'),
    phone: $('order-phone'),
    address: $('order-address'),
    addressField: $('address-field'),
    pickupField: $('pickup-field'),
    pickupSelect: $('order-pickup'),
    comment: $('order-comment'),
    promoForm: $('promo-form'),
    promoInput: $('promo-input'),
    promoBtn: $('promo-btn'),
    promoMsg: $('promo-msg'),
    locationSelect: $('location-select'),
    toast: $('toast'),
    done: {
      title: $('order-done-title'),
      number: $('done-number'),
      text: $('done-text'),
      type: $('done-type'),
      total: $('done-total'),
    },
  };

  /* ==========================================================================
     Слои (модалка и корзина): открытие, закрытие, фокус, Esc
     ========================================================================== */
  const lastFocus = new Map();

  function isOpen(layer) { return layer.classList.contains('is-open'); }

  function openLayer(layer) {
    lastFocus.set(layer, document.activeElement);
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    const dialog = layer.querySelector('[role="dialog"]');
    requestAnimationFrame(() => dialog.focus({ preventScroll: true }));
  }

  function closeLayer(layer) {
    if (!isOpen(layer)) return;
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
    if (!isOpen(el.modal) && !isOpen(el.drawer)) document.body.classList.remove('no-scroll');
    const prev = lastFocus.get(layer);
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true });
    lastFocus.delete(layer);
  }

  function openDrawer() {
    closeLayer(el.modal);
    if (el.drawerPanel.classList.contains('is-done')) leaveDoneScreen();
    renderCart();
    openLayer(el.drawer);
  }

  function leaveDoneScreen() {
    el.drawerPanel.classList.remove('is-done');
    $('order-done').hidden = true;
  }

  function focusables(container) {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...container.querySelectorAll(selector)].filter((n) => n.getClientRects().length > 0);
  }

  document.addEventListener('keydown', (event) => {
    const layer = isOpen(el.modal) ? el.modal : isOpen(el.drawer) ? el.drawer : null;
    if (!layer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLayer(layer);
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = layer.querySelector('[role="dialog"]');
    const nodes = focusables(dialog);
    if (!nodes.length) { event.preventDefault(); dialog.focus(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });

  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) {
      closeLayer(closer.dataset.close === 'modal' ? el.modal : el.drawer);
      return;
    }
    if (event.target.closest('#cart-open, #floating-cart-open')) { openDrawer(); return; }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const item = itemById(action.dataset.id);
    if (!item) return;
    const card = action.closest('.card');
    const variantId = card ? card.dataset.variant : item.defaultVariant;
    if (action.dataset.action === 'customize') openCustomizer(item, variantId);
    else if (action.dataset.action === 'add') addDirect(item, variantId);
  });

  /* ==========================================================================
     Toast
     ========================================================================== */
  let toastTimer = null;
  function showToast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
  }

  /* ==========================================================================
     Меню: рендер карточек из MENU_ITEMS и табы категорий
     ========================================================================== */
  const menuGrid = $('menu-grid');
  const menuEmpty = $('menu-empty');
  const itemById = (id) => MENU_ITEMS.find((i) => i.id === id);
  const variantOf = (item, id) => item.variants.find((v) => v.id === id) || item.variants[0];

  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildMedia(item) {
    const media = node('div', 'card__media');
    const placeholder = () => {
      const empty = node('div', 'card__img card__img--empty');
      empty.setAttribute('role', 'img');
      empty.setAttribute('aria-label', item.name);
      empty.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-image"/></svg>';
      return empty;
    };
    const img = node('img', 'card__img');
    img.src = imageSrc(item.photo);
    img.alt = item.name;
    img.width = 800;
    img.height = 420;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(placeholder()));
    media.append(img);
    if (item.isNew) media.append(node('span', 'badge', 'Новинка'));
    return media;
  }

  function buildCard(item) {
    const card = node('article', 'card');
    card.dataset.id = item.id;
    card.dataset.category = item.category;
    card.dataset.variant = item.defaultVariant;
    // Соусы и напитки: уменьшенное фото на белом фоне
    if (item.category === 'sauces' || item.category === 'drinks') card.classList.add('card--compact');

    const weight = node('span', 'card__weight');
    const top = node('div', 'card__top');
    top.append(node('h3', 'card__title', item.name), weight);
    const body = node('div', 'card__body');
    body.append(top);
    if (item.description) body.append(node('p', 'card__desc', item.description));

    if (item.variants.length > 1) {
      const pills = node('div', 'pills');
      pills.setAttribute('role', 'radiogroup');
      pills.setAttribute('aria-label', `Размер: ${item.name}`);
      item.variants.forEach((v) => {
        const pill = node('button', 'pill', v.label);
        pill.type = 'button';
        pill.dataset.variant = v.id;
        pill.setAttribute('role', 'radio');
        pills.append(pill);
      });
      body.append(pills);
    }

    const price = node('p', 'card__price');
    const priceValue = node('span', 'card__price-value');
    price.append(priceValue, node('span', 'card__price-cur', 'BYN'));

    const custom = item.extras.length > 0;
    const label = custom ? 'Выбрать' : 'В корзину';
    const button = node('button', 'btn btn--primary btn--sm', label);
    button.type = 'button';
    button.dataset.action = custom ? 'customize' : 'add';
    button.dataset.id = item.id;
    button.setAttribute('aria-label', `${label}: ${item.name}`);

    const footer = node('div', 'card__footer');
    footer.append(price, button);

    card.append(buildMedia(item), body, footer);
    renderCardVariant(card, item);
    return card;
  }

  // Цена, вес и состояние пилюль карточки по выбранному варианту
  function renderCardVariant(card, item) {
    const variant = variantOf(item, card.dataset.variant);
    card.querySelector('.card__price-value').textContent = money(variant.price);
    const weight = card.querySelector('.card__weight');
    weight.textContent = variant.weight;
    weight.hidden = !variant.weight;
    card.querySelectorAll('.pill').forEach((pill) => {
      const active = pill.dataset.variant === variant.id;
      pill.setAttribute('aria-checked', String(active));
      pill.tabIndex = active ? 0 : -1;
    });
  }

  menuGrid.replaceChildren(...MENU_ITEMS.map(buildCard));

  menuGrid.addEventListener('click', (event) => {
    const pill = event.target.closest('.pill');
    if (!pill) return;
    const card = pill.closest('.card');
    card.dataset.variant = pill.dataset.variant;
    renderCardVariant(card, itemById(card.dataset.id));
  });

  menuGrid.addEventListener('keydown', (event) => {
    const pill = event.target.closest('.pill');
    if (!pill || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const pills = [...pill.parentElement.children];
    const next = pills[(pills.indexOf(pill) + (event.key === 'ArrowRight' ? 1 : -1) + pills.length) % pills.length];
    event.preventDefault();
    next.click();
    next.focus();
  });

  const tabs = [...document.querySelectorAll('#menu-tabs .tab')];
  const cards = [...menuGrid.querySelectorAll('.card')];

  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });
    menuGrid.setAttribute('aria-labelledby', tab.id);
    const category = tab.dataset.category;
    let visible = 0;
    cards.forEach((card) => {
      const show = category === 'all' || card.dataset.category === category;
      card.hidden = !show;
      if (show) visible += 1;
    });
    menuEmpty.hidden = visible > 0;
    if (focus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); selectTab(next, true); }
    });
  });

  /* ==========================================================================
     Добавление без настроек (комбо, закуски, соусы, напитки)
     ========================================================================== */
  function cartLine(item, variant, extras, unitPrice, qty) {
    const labelled = item.variants.length > 1;
    return {
      key: [item.id, variant.id, extras.map((e) => e.value).sort().join('+')].join('|'),
      id: item.id,
      name: item.name,
      image: imageSrc(item.photo),
      weight: variant.weight || variant.label,
      size: variant.id,
      sizeLabel: labelled ? [variant.label, variant.weight].filter(Boolean).join(' · ') : '',
      extras: extras.map(({ value, name }) => ({ value, name })),
      unitPrice,
      qty,
    };
  }

  function addDirect(item, variantId) {
    const variant = variantOf(item, variantId);
    addItem(cartLine(item, variant, [], variant.price, 1));
    showToast(`Добавлено: ${item.name}`);
  }

  /* ==========================================================================
     Кастомизатор блюда (шаурма, пита): размер и добавки
     ========================================================================== */
  const customizer = {
    form: $('customizer-form'),
    title: $('modal-title'),
    desc: $('modal-desc'),
    weight: $('modal-weight'),
    img: $('modal-img'),
    sizeGroup: $('size-group'),
    sizeOptions: $('size-options'),
    extrasGroup: $('extras-group'),
    qty: $('modal-qty'),
    price: $('modal-price'),
    product: null,
    count: 1,
  };

  function readSelection() {
    const item = customizer.product;
    const checked = customizer.form.querySelector('input[name="size"]:checked');
    const variant = variantOf(item, checked ? checked.value : item.defaultVariant);
    const extras = [...customizer.form.querySelectorAll('input[name="extras"]:checked:not(:disabled)')].map((input) => ({
      value: input.value,
      name: input.closest('.check').querySelector('.check__name').textContent.trim(),
      price: toCents(input.dataset.price),
    }));
    const unit = variant.price + extras.reduce((sum, e) => sum + e.price, 0);
    return { variant, extras, unit };
  }

  function updateCustomizerPrice() {
    const { variant, unit } = readSelection();
    customizer.qty.textContent = String(customizer.count);
    customizer.price.textContent = money(unit * customizer.count);
    customizer.weight.textContent = variant.weight;
  }

  function buildSizeOptions(item, selectedId) {
    customizer.sizeOptions.replaceChildren(...item.variants.map((v) => {
      const label = node('label', 'option');
      const input = node('input');
      input.type = 'radio';
      input.name = 'size';
      input.value = v.id;
      input.checked = v.id === selectedId;
      const box = node('span', 'option__box');
      box.append(node('span', 'option__name', v.label), node('span', 'option__hint', v.weight), node('span', 'option__price', `${money(v.price)} BYN`));
      label.append(input, box);
      return label;
    }));
  }

  function openCustomizer(item, variantId) {
    if (!item || item.extras.length === 0) return;
    customizer.product = item;
    customizer.count = 1;
    customizer.form.reset();

    customizer.title.textContent = item.name;
    customizer.desc.textContent = item.description;
    customizer.img.src = imageSrc(item.photo);
    customizer.img.alt = item.name;

    // Размер показываем только если у блюда их несколько (у питы вес фиксирован)
    const selected = variantOf(item, variantId || item.defaultVariant).id;
    customizer.sizeGroup.hidden = item.variants.length < 2;
    buildSizeOptions(item, selected);

    customizer.form.querySelectorAll('input[name="extras"]').forEach((input) => {
      const allowed = item.extras.includes(input.value);
      input.disabled = !allowed;
      input.closest('.check').hidden = !allowed;
    });
    customizer.extrasGroup.hidden = item.extras.length === 0;

    updateCustomizerPrice();
    closeLayer(el.drawer);
    openLayer(el.modal);
  }

  customizer.img.addEventListener('error', () => { customizer.img.removeAttribute('src'); });

  customizer.form.addEventListener('change', updateCustomizerPrice);

  customizer.form.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-qty]');
    if (!btn) return;
    customizer.count = Math.min(MAX_QTY, Math.max(1, customizer.count + Number(btn.dataset.qty)));
    updateCustomizerPrice();
  });

  customizer.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const item = customizer.product;
    if (!item) return;
    const { variant, extras, unit } = readSelection();
    addItem(cartLine(item, variant, extras, unit, customizer.count));
    closeLayer(el.modal);
    showToast(`Добавлено: ${item.name}`);
  });

  /* ==========================================================================
     Корзина: операции
     ========================================================================== */
  function addItem(line) {
    const existing = state.items.find((i) => i.key === line.key);
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + line.qty);
    else state.items.push(line);
    commit();
  }

  function changeQty(key, delta) {
    const item = state.items.find((i) => i.key === key);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) state.items = state.items.filter((i) => i.key !== key);
    else item.qty = Math.min(MAX_QTY, item.qty);
    commit();
  }

  function removeItem(key) {
    state.items = state.items.filter((i) => i.key !== key);
    commit();
  }

  function commit() {
    saveState();
    renderCart();
  }

  el.cartList.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-qty], [data-remove]');
    if (!btn) return;
    const key = btn.closest('.cart-item').dataset.key;
    const selector = btn.hasAttribute('data-remove') ? '[data-remove]' : `[data-qty="${btn.dataset.qty}"]`;
    if (btn.hasAttribute('data-remove')) removeItem(key);
    else changeQty(key, Number(btn.dataset.qty));
    // Возвращаем фокус на ту же кнопку после перерисовки списка (клавиатурные пользователи).
    const li = [...el.cartList.querySelectorAll('.cart-item')].find((n) => n.dataset.key === key);
    const target = li ? li.querySelector(selector) : null;
    if (target) target.focus();
  });

  /* ==========================================================================
     Рендер
     ========================================================================== */
  function bump(node) {
    node.classList.remove('is-bump');
    void node.offsetWidth;
    node.classList.add('is-bump');
  }

  let prevCount = 0;

  function renderCart() {
    const calc = calculate();

    // Бейджи и нижняя панель
    el.cartCount.textContent = String(calc.count);
    el.floatCount.textContent = String(calc.count);
    el.floatTotal.textContent = money(calc.subtotal);
    el.cartOpen.setAttribute('aria-label', `Открыть корзину, товаров: ${calc.count}`);
    if (calc.count > prevCount) {
      bump(el.cartCount);
      bump(el.floatCount.parentElement);
    }
    prevCount = calc.count;

    // Список
    el.cartList.querySelectorAll('.cart-item').forEach((n) => n.remove());
    el.cartEmpty.hidden = state.items.length > 0;
    state.items.forEach((item) => {
      const node = el.cartTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.key = item.key;
      const thumb = node.querySelector('.cart-item__thumb');
      thumb.src = item.image;
      thumb.addEventListener('error', () => thumb.remove());
      node.querySelector('.cart-item__title').textContent = item.name;
      const opts = [item.sizeLabel, ...item.extras.map((e) => e.name)].filter(Boolean);
      node.querySelector('.cart-item__opts').textContent = (opts.length ? opts : [item.weight]).join(' · ');
      node.querySelector('.qty__value').textContent = String(item.qty);
      node.querySelector('.cart-item__price span').textContent = money(item.unitPrice * item.qty);
      node.querySelector('.qty').setAttribute('aria-label', `Количество: ${item.name}`);
      el.cartList.append(node);
    });

    // Прогресс бесплатной доставки
    const showProgress = !calc.pickup && calc.count > 0;
    el.progress.hidden = !showProgress;
    if (showProgress) {
      const left = FREE_DELIVERY_FROM - calc.subtotal;
      const percent = Math.min(100, Math.round((calc.subtotal / FREE_DELIVERY_FROM) * 100));
      el.progress.classList.toggle('is-complete', left <= 0);
      el.progressText.textContent = '';
      if (left > 0) {
        el.progressText.append('До бесплатной доставки осталось ');
        const strong = document.createElement('b');
        strong.textContent = `${money(left)} BYN`;
        el.progressText.append(strong);
      } else {
        el.progressText.textContent = 'Бесплатная доставка по Минску';
      }
      el.progressBar.style.width = `${percent}%`;
      el.progressTrack.setAttribute('aria-valuenow', String(percent));
    }

    // Итоги
    el.totalItems.textContent = money(calc.subtotal);
    el.discountRow.hidden = calc.discount === 0;
    el.discountLabel.textContent = calc.discountLabel;
    el.totalDiscount.textContent = money(calc.discount);
    if (calc.count === 0) el.totalDelivery.textContent = '—';
    else if (calc.pickup) el.totalDelivery.textContent = '0.00 BYN';
    else if (calc.delivery === 0) el.totalDelivery.textContent = 'Бесплатно';
    else el.totalDelivery.textContent = `${money(calc.delivery)} BYN`;
    el.totalGrand.textContent = money(calc.total);

    el.submit.disabled = state.items.length === 0 || submitting;
    renderPromo();
  }

  /* ==========================================================================
     Промокод
     ========================================================================== */
  function setPromoMessage(type, text) {
    el.promoMsg.hidden = !text;
    el.promoMsg.textContent = text || '';
    el.promoMsg.className = `promo-msg${type ? ` is-${type}` : ''}`;
  }

  function renderPromo() {
    if (state.promo) {
      const percent = PROMO_CODES[state.promo];
      el.promoInput.value = state.promo;
      el.promoInput.disabled = true;
      el.promoBtn.textContent = 'Убрать';
      if (state.mode === 'pickup') {
        setPromoMessage('info', `Промокод ${state.promo} принят. При самовывозе уже действует скидка ${PICKUP_DISCOUNT}% — скидки не суммируются.`);
      } else {
        setPromoMessage('success', `Промокод ${state.promo} применён: скидка ${percent}% на блюда.`);
      }
    } else {
      el.promoInput.disabled = false;
      el.promoBtn.textContent = 'Применить';
      if (promoError) setPromoMessage('error', promoError);
      else setPromoMessage(null, '');
    }
  }

  el.promoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.promo) {
      state.promo = null;
      promoError = null;
      el.promoInput.value = '';
      commit();
      el.promoInput.focus();
      return;
    }
    const code = el.promoInput.value.trim().toUpperCase();
    if (!code) { promoError = 'Введите промокод.'; renderPromo(); return; }
    if (!Object.prototype.hasOwnProperty.call(PROMO_CODES, code)) {
      promoError = 'Такого промокода нет. Проверьте написание.';
      renderPromo();
      return;
    }
    promoError = null;
    state.promo = code;
    commit();
  });

  el.promoInput.addEventListener('input', () => {
    if (promoError) { promoError = null; renderPromo(); }
  });

  /* ==========================================================================
     Доставка / самовывоз
     ========================================================================== */
  function applyMode() {
    const checked = el.form.querySelector('input[name="delivery"]:checked');
    state.mode = checked && checked.value === 'pickup' ? 'pickup' : 'delivery';
    const pickup = state.mode === 'pickup';
    el.addressField.hidden = pickup;
    el.pickupField.hidden = !pickup;
    el.address.required = !pickup;
    clearFieldError(el.address);
    el.form.querySelectorAll('.pay__name').forEach((n) => {
      n.textContent = pickup ? n.dataset.pickup : n.dataset.delivery;
    });
    renderCart();
  }

  el.form.querySelectorAll('input[name="delivery"]').forEach((input) => input.addEventListener('change', applyMode));

  // Выбор точки в шапке задаёт точку самовывоза по умолчанию
  function syncLocation(value) {
    if ([...el.pickupSelect.options].some((o) => o.value === value)) el.pickupSelect.value = value;
  }
  el.locationSelect.addEventListener('change', () => {
    store.set(LOCATION_KEY, el.locationSelect.value);
    syncLocation(el.locationSelect.value);
  });

  /* ==========================================================================
     Маска телефона и валидация
     ========================================================================== */
  function phoneDigits(value) {
    let d = value.replace(/\D/g, '');
    if (d.startsWith('375')) d = d.slice(3);
    else if (d.startsWith('80')) d = d.slice(2);
    return d.slice(0, 9);
  }

  function formatPhone(d) {
    let out = '+375';
    if (d.length > 0) out += ` (${d.slice(0, 2)}`;
    if (d.length > 2) out += `) ${d.slice(2, 5)}`;
    if (d.length > 5) out += `-${d.slice(5, 7)}`;
    if (d.length > 7) out += `-${d.slice(7, 9)}`;
    return out;
  }

  el.phone.addEventListener('input', () => {
    const d = phoneDigits(el.phone.value);
    el.phone.value = d ? formatPhone(d) : '';
    clearFieldError(el.phone);
  });
  el.phone.addEventListener('focus', () => {
    if (!el.phone.value) {
      el.phone.value = '+375 (';
      setTimeout(() => el.phone.setSelectionRange(el.phone.value.length, el.phone.value.length), 0);
    }
  });
  el.phone.addEventListener('blur', () => {
    if (!phoneDigits(el.phone.value)) el.phone.value = '';
  });

  function errorNode(input) { return $(`${input.id}-error`); }

  function setFieldError(input, message) {
    const node = errorNode(input);
    input.setAttribute('aria-invalid', 'true');
    node.textContent = message;
    node.hidden = false;
  }

  function clearFieldError(input) {
    const node = errorNode(input);
    input.removeAttribute('aria-invalid');
    if (node) { node.hidden = true; node.textContent = ''; }
  }

  [el.name, el.address].forEach((input) => input.addEventListener('input', () => clearFieldError(input)));

  function validateForm() {
    let firstInvalid = null;
    const fail = (input, message) => {
      setFieldError(input, message);
      if (!firstInvalid) firstInvalid = input;
    };

    if (el.name.value.trim().length < 2) fail(el.name, 'Укажите имя (минимум 2 символа).');
    if (!PHONE_RE.test(phoneDigits(el.phone.value))) fail(el.phone, 'Введите номер в формате +375 (29) 123-45-67.');
    if (state.mode === 'delivery' && el.address.value.trim().length < 5) {
      fail(el.address, 'Укажите адрес доставки: улица, дом, квартира.');
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  /* ==========================================================================
     Отправка заказа
     ========================================================================== */
  function showFormError(message) {
    el.formError.textContent = message;
    el.formError.hidden = !message;
  }

  function setLoading(loading) {
    submitting = loading;
    el.submit.classList.toggle('is-loading', loading);
    el.submit.textContent = loading ? 'Отправляем…' : 'Оформить заказ';
    el.submit.disabled = loading || state.items.length === 0;
    el.submit.setAttribute('aria-busy', String(loading));
  }

  function userError(message) {
    const err = new Error(message);
    err.user = true;
    return err;
  }

  async function sendOrder(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* не JSON */ }
      if (!res.ok || !data || !data.ok) {
        throw userError((data && data.error) || `Сервис приёма заказов временно недоступен. Позвоните нам: ${SHOP_PHONE}.`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    showFormError('');
    if (state.items.length === 0) { showFormError('Корзина пуста — добавьте блюда из меню.'); return; }
    if (!validateForm()) return;

    const pickup = state.mode === 'pickup';
    const payload = {
      items: state.items.map((i) => ({ id: i.id, size: i.size, extras: i.extras.map((e) => e.value), qty: i.qty })),
      delivery: state.mode,
      location: el.locationSelect.value,
      pickupPoint: pickup ? el.pickupSelect.value : '',
      address: pickup ? '' : el.address.value.trim(),
      promo: state.promo || '',
      payment: el.form.querySelector('input[name="payment"]:checked').value,
      name: el.name.value.trim(),
      phone: formatPhone(phoneDigits(el.phone.value)),
      comment: el.comment.value.trim(),
    };
    // Человекочитаемые поля заказа. Сервер использует их только для сверки:
    // состав и сумму он всегда пересчитывает сам по items.
    const checkedPay = el.form.querySelector('input[name="payment"]:checked');
    Object.assign(payload, {
      deliveryType: pickup ? 'Самовывоз' : 'Доставка',
      itemsText: state.items
        .map((i) => `${i.name}${i.sizeLabel ? ` (${i.sizeLabel})` : ''}${i.extras.length ? ` + ${i.extras.map((e) => e.name).join(', ')}` : ''} × ${i.qty}`)
        .join('; '),
      paymentMethod: checkedPay.closest('.pay').querySelector('.pay__name').textContent.trim(),
      promoCode: state.promo || '',
      total: money(calculate().total),
    });
    const phoneShown = payload.phone;
    const pickupLabel = el.pickupSelect.options[el.pickupSelect.selectedIndex].textContent.trim();

    setLoading(true);
    try {
      const data = await sendOrder(payload);
      showSuccess(data, { pickup, phone: phoneShown, pickupLabel });
    } catch (err) {
      showFormError(err && err.user ? err.message : NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  });

  function showSuccess(data, ctx) {
    state.items = [];
    state.promo = null;
    promoError = null;
    el.promoInput.value = '';
    saveState();
    el.form.reset();
    clearFieldError(el.name);
    clearFieldError(el.phone);
    clearFieldError(el.address);
    syncLocation(el.locationSelect.value);
    applyMode(); // сбрасывает режим в «Доставка» и перерисовывает корзину

    el.done.number.textContent = data.orderNumber;
    el.done.total.textContent = data.total;
    el.done.type.textContent = ctx.pickup ? `Самовывоз — ${ctx.pickupLabel}` : 'Доставка по Минску';
    el.done.text.textContent = ctx.pickup
      ? `Мы позвоним на ${ctx.phone}, чтобы подтвердить заказ. Он будет готов к выдаче примерно через 7–10 минут.`
      : `Мы позвоним на ${ctx.phone}, чтобы подтвердить заказ. Курьер привезёт его за 35–45 минут.`;
    $('order-done').hidden = false;
    el.drawerPanel.classList.add('is-done');
    el.drawerPanel.scrollTop = 0;
    el.done.title.focus({ preventScroll: true });
  }

  /* ==========================================================================
     Старт
     ========================================================================== */
  loadState();
  const savedLocation = store.get(LOCATION_KEY);
  if (savedLocation && [...el.locationSelect.options].some((o) => o.value === savedLocation)) {
    el.locationSelect.value = savedLocation;
  }
  syncLocation(el.locationSelect.value);
  prevCount = state.items.reduce((s, i) => s + i.qty, 0);
  applyMode();
})();
