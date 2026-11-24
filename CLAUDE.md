# FIRE SHAWARMA — памятка для Claude

Сайт шаурмичной в Минске: статический HTML/CSS/vanilla JS + одна Cloudflare Pages Function. Без сборки и фреймворков.
Отвечай по-русски, кратко. Код, пути и команды оставляй как есть.

## Экономия токенов (главные правила)
- Не читай файлы целиком. `style.css` (~1400 строк) и `app.js` (~900 строк): сначала `grep -n` по селектору или функции, затем читай только нужный диапазон (`offset`/`limit`).
- Не делай скриншоты и не запускай браузер без запроса. Проверка правки: один короткий JS-вызов или `node --check`.
- Не пересказывай сделанное. В ответе: что изменено, в каком файле, что осталось проверить.
- Несколько правок группируй в один проход, а не по одной.
- Каталог меню, цены и фото уже описаны ниже. Не читай `app.js`, чтобы узнать их.

## Файлы
| Файл | Что внутри |
|---|---|
| `index.html` | разметка, SVG-спрайт, модальное окно блюда `#dish-modal`, корзина `#cart-drawer`, шаблон строки корзины |
| `style.css` | вся тема (переменные в `:root`), карточки `.card`, перки `.perks`, модалка, шторка корзины |
| `app.js` | `MENU_ITEMS` (23 позиции), карточки, пилюли размера, кастомизатор, корзина, промокод, телефон, отправка заказа |
| `functions/api/sendOrder.js` | валидация, пересчёт цен на сервере (`CATALOG`), чек в Telegram, JSON в Google Таблицу |
| `google-apps-script.js` | код для вставки в Apps Script (`doPost`), создаёт лист «Заказы» |
| `images/1.jpg`–`24.jpg` | только локальные фото. 1 = hero, 2–24 = блюда по порядку меню |
| `.env.example`, `.gitignore`, `README.md` | конфиг, список переменных, портфолио-описание |

## Правила, которые нельзя ломать
- Цены, варианты (`variants`) и добавки (`extras`) дублируются в `app.js` (`MENU_ITEMS`) и `sendOrder.js` (`CATALOG`). Меняешь в одном, меняй в другом. Деньги в копейках (целые числа).
- Не менять ID и классы: `#cart-open`, `#cart-count`, `#menu-grid`, `#menu-tabs`, `#dish-modal`, `#size-options`, `#extras-group`, `#cart-drawer`, `#checkout-form`, `#promo-form`, `#order-done` и др. На них завязан JS.
- Ключ корзины в localStorage: `fire-shawarma:cart:v3`. При смене формата строки корзины повышай версию.
- Эмодзи на сайте нет. Внешних картинок нет (только `./images/`). Единственные внешние ресурсы: Google Fonts.
- Скидки не суммируются: самовывоз -10% ИЛИ промокод `MINSK10` -10% (только доставка). Доставка 3.00 BYN, бесплатно от 25.00 BYN (считается до скидок).
- Клиентским суммам сервер не доверяет: цену всегда считает `sendOrder.js`.
- Фото карточек: `object-fit: contain` на белом фоне. Высоты по категориям в `style.css` (шаурма 170px, комбо 140px, пита и закуски 120px, соусы и напитки 140px).

## Дизайн
Светлая тема: фон `#FAF9F6`, карточки `#FFFFFF`, линии `#E8E5DF`, текст `#222426`, вторичный `#6E6D6A`, акцент `#C84B31` (hover `#B03E26`). Шрифты: Plus Jakarta Sans (заголовки), Manrope (текст).

## Деплой и инфраструктура
- Сайт: https://fire-shawarma-8qt.pages.dev (Cloudflare Pages, проект `fire-shawarma`). Старый Netlify-сайт не используется.
- Репозиторий: https://github.com/matthewu409/fire-shawarma-minsk, ветка `main`.
- Деплой: `cd ~/Claude/minsk-shawarma && rm -rf dist && mkdir dist && cp -R index.html style.css app.js images dist/ && npx -y wrangler pages deploy dist --project-name fire-shawarma --branch main`
- Функция: `functions/api/sendOrder.js`, эндпоинт `/api/sendOrder`.
- Секреты (Cloudflare: Pages, fire-shawarma, Settings, Variables and Secrets, Production; задаёт пользователь): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_SHEET_URL`. После изменения нужен новый деплой.
- Заказы приходят в Telegram и в Google Таблицу «Новая таблица» (лист «Заказы») на Диске пользователя.

## Что Claude не делает сам
Не вводит токены и пароли, не меняет защиту доступа сервисов, не открывает доступ к аккаунтам. Это делает пользователь.

## Локальная проверка
`file://` не подходит: заказ уходит только на задеплоенный сайт или через `npx wrangler pages dev dist`. Для просмотра статики: `python3 -m http.server 8765` в папке проекта.
