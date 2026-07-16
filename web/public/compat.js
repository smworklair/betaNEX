// Страж совместимости (намеренно ES5, чтобы разбирался где угодно).
// Дизайн NEX построен на color-mix() — это Chrome 111+, Samsung
// Internet 22+, Safari 16.2+. В старых браузерах страница выглядит
// «пустой»: фоны и кнопки становятся прозрачными. Вместо этого
// показываем человеку понятное объяснение, что делать.
//
// Вынесено во внешний файл (а не инлайн в index.html), чтобы CSP мог
// запрещать 'unsafe-inline' для script-src без хэшей/nonce.
(function () {
  var ok = false;
  try {
    ok = !!(window.CSS && CSS.supports && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'));
  } catch (e) { /* совсем старый браузер */ }
  // Сообщение рисуется поверх всего: в старом браузере React может
  // отрисовать приложение, но со сломанными стилями — его прячем.
  function fallback(title, text) {
    if (document.getElementById('nex-compat')) return;
    var el = document.createElement('div');
    el.id = 'nex-compat';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#eef1f7;color:#16171d;text-align:center');
    el.innerHTML =
      '<div style="max-width:420px"><div style="font-size:40px;margin-bottom:12px">&#128075;</div>' +
      '<h1 style="font-size:20px;margin:0 0 10px">' + title + '</h1>' +
      '<p style="font-size:15px;line-height:1.55;color:#55565f;margin:0">' + text + '</p></div>';
    (document.body || document.documentElement).appendChild(el);
  }
  if (!ok) {
    document.addEventListener('DOMContentLoaded', function () {
      fallback('Браузер устарел для NEX',
        'Обновите браузер в Galaxy Store или Google Play — или откройте эту страницу в Chrome. После обновления всё заработает.');
    });
    return;
  }
  // Страховка: если приложение упало до первого рендера (ошибка
  // скрипта, несовместимый WebView) — не оставляем белый экран.
  window.addEventListener('error', function () {
    setTimeout(function () {
      var root = document.getElementById('root');
      if (root && !root.childElementCount) {
        fallback('Не получилось открыть NEX',
          'Попробуйте обновить страницу. Если не помогает — обновите браузер или откройте страницу в Chrome.');
      }
    }, 0);
  });
})();
