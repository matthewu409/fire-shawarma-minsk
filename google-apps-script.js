/**
 * FIRE SHAWARMA: приём заказов в Google Таблицу.
 *
 * КАК ПОДКЛЮЧИТЬ (5 минут):
 *  1. Создайте Google Таблицу (sheets.new), назовите её, например, «Заказы FIRE SHAWARMA».
 *  2. Меню «Расширения» -> «Apps Script».
 *  3. Удалите всё в редакторе, вставьте этот файл целиком, нажмите «Сохранить».
 *  4. «Развернуть» -> «Новое развертывание» -> тип «Веб-приложение»:
 *       - Выполнять как: «Я» (ваш аккаунт)
 *       - У кого есть доступ: «Все»
 *     Нажмите «Развернуть» и разрешите доступ к таблице (Advanced -> Go to project).
 *  5. Скопируйте «URL веб-приложения» (начинается с https://script.google.com/macros/s/...).
 *  6. В Netlify: Site configuration -> Environment variables -> GOOGLE_SHEET_URL = этот URL.
 *     После добавления переменной сделайте новый деплой (Deploys -> Trigger deploy).
 *
 * Заголовки столбцов создаются автоматически при первом заказе.
 * Если вы измените этот код, нужно снова «Развернуть» -> «Управление развертываниями» ->
 * «Редактировать» -> «Новая версия», иначе работает старая версия.
 */

var SHEET_NAME = 'Заказы';

var HEADERS = [
  'Дата',
  'Номер заказа',
  'Имя',
  'Телефон',
  'Получение',
  'Адрес / точка',
  'Состав заказа',
  'Оплата',
  'Промокод',
  'Комментарий',
  'Сумма, BYN'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#F4F2ED');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      data.createdAt || Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyyy-MM-dd HH:mm'),
      data.orderNumber || '',
      data.name || '',
      // Апостроф в начале: Google не превращает номер в формулу или число
      "'" + (data.phone || ''),
      data.deliveryType || '',
      data.address || '',
      data.itemsText || '',
      data.paymentMethod || '',
      data.promoCode || '',
      data.comment || '',
      Number(data.total) || 0
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Скрипт создан из таблицы (Расширения -> Apps Script): берём её.
// Скрипт создан отдельно на script.google.com: один раз создаём таблицу
// «Заказы FIRE SHAWARMA» в вашем Google Диске и запоминаем её id.
function getSpreadsheet() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  var created = SpreadsheetApp.create('Заказы FIRE SHAWARMA');
  props.setProperty('SPREADSHEET_ID', created.getId());
  return created;
}

// Проверка: откройте URL веб-приложения в браузере, должно показать {"ok":true,...}
function doGet() {
  return jsonResponse({ ok: true, service: 'fire-shawarma-orders' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
