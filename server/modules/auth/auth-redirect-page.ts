/**
 * Сторінка-відбивач після callback зовнішнього провайдера.
 *
 * **Чому не 302.** Cookie сесії має `SameSite=Strict`. Callback приходить
 * переходом із сайту провайдера, тобто крос-сайтовим; поставити cookie у
 * відповіді на такий перехід можна, а от якщо відповісти редиректом на `/`,
 * браузер вважає весь ланцюжок переходів крос-сайтовим і Strict-cookie з
 * запитом до `/` **не надішле**. Застосунок відкривається неавторизованим —
 * і виглядає це так, ніби вхід не спрацював, хоча сесія вже створена.
 *
 * Тому callback віддає звичайний документ із нашого ж походження, а перехід на
 * `/` робить уже він. Ця навігація ініційована нашою сторінкою, вона same-site,
 * і cookie йде як належить.
 *
 * Послаблювати cookie до `SameSite=Lax` заради редиректу було б помилковим
 * розміном: Strict — один із двох бар'єрів проти CSRF (другий — заголовок
 * `X-Requested-With`), і платити ним за одну сторінку переходу ні до чого.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Документ, який одразу переходить за вказаною адресою.
 *
 * `location.replace`, а не присвоєння: інакше callback лишався б в історії, і
 * кнопка «назад» повертала б браузер на URL із уже погашеним `code`.
 * `<meta refresh>` — на випадок вимкненого JS: тоді перехід теж крос-сайтовий,
 * але це гірший сценарій, а не зламаний — застосунок покаже екран входу.
 */
export function redirectBouncePage(target: string): string {
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
<title>Вхід…</title>
</head>
<body>
<script>location.replace(${JSON.stringify(target)});</script>
<noscript><a href="${escapeHtml(target)}">Продовжити</a></noscript>
</body>
</html>
`;
}

export function htmlResponse(
  body: string,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "text/html; charset=utf-8");
  // Сторінка одноразова й пов'язана з погашеним `code` — кешувати її нема сенсу
  // ні проміжним вузлам, ні браузеру.
  responseHeaders.set("cache-control", "no-store");
  return new Response(body, { status, headers: responseHeaders });
}
