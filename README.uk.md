# Altera

[English](README.md) | **Українська**

**Altera — це harness для AI-агента, призначений для побудови бізнес-застосунків.**
Облікову систему тут пише агент (Claude Code), а фреймворк дає йому рейки: модель
описується декларативно, рутина (CRUD, списки, форми, друк, права, журнал) береться з
ядра, а правила того, як писати кожен шар, агент читає зі скілів, що їдуть разом із
застосунком. Брак можливості фреймворку не обходиться в застосунку, а усувається в ядрі —
тому код, який пише агент, лишається одноманітним і передбачуваним.

Перший прикладний домен — бухгалтерський облік для України (план рахунків, проводки з
субконто, первинні документи, звіти), але механізм загальний: довідники, документи з
проведенням, регістри, звіти.

## Демо

Розгорнутий приклад бухгалтерії на Altera — **<https://altera-ai.com.ua>**
(вхід: `admin` / `DemoAdmin`).

## Натхнення

Ідеї й словник Altera походять від платформи **A2v10**
[Олександра Кухтіна (Alex Kukhtin)](https://github.com/alex-kukhtin): модель як основна одиниця, логіка в SQL-функціях
бази, один конверт відповіді на весь API, шаблони друку як дані. Altera переносить цей
підхід на сучасний веб-стек і робить головним «розробником» агента.

## Стек

| Шар | Технології |
|---|---|
| Рантайм | [Deno](https://deno.com) 2.9+, монорепозиторій із workspace-пакетами |
| База даних | PostgreSQL 15+ — функції `{schema}.{model}_{command}(user_id, payload jsonb)` |
| Backend | [Danet](https://danet.land) — один HTTP-рантайм моделей, без контролера на модель |
| Frontend | Lit Web Components, Vite, Tailwind CSS v4, daisyUI v5 |
| Контракти | TypeBox — одна схема на модель для сервера, SQL і форми |
| Друк | власний рендерер PDF (pdf-lib), шаблони — дані в базі |
| Агент | HTTP-API для зовнішнього агента, MCP-обгортка `@altera/mcp`, персональні токени |

Фреймворк публікується на [JSR](https://jsr.io/@altera) пакетами `@altera/server`,
`@altera/client`, `@altera/tools`, `@altera/create`, `@altera/skills`.

## Що потрібно заздалегідь

- **Deno 2.9+** — <https://docs.deno.com/runtime/getting_started/installation/>.
  Node.js не потрібен: npm-залежності ставить Deno.
- **PostgreSQL 15+** — або **Docker** (застосунок піднімає базу сам, `deno task startdb`),
  або наявний сервер, на якому можна створити окрему базу.
- **Claude Code** — CLI, десктопний застосунок або розширення IDE:
  <https://docs.claude.com/en/docs/claude-code>.
- `curl` (на Windows — вбудований `curl.exe`) і, за бажанням, `git`.

## Встановлення за допомогою Claude

Застосунок розгортає сам агент — скілом `altera-new-app`: від scaffold до екрана входу,
з перевіркою кожного кроку (порти, `.env`, база, залежності, публікація схеми, перший
адміністратор). Потрібно лише покласти скіл у порожню папку.

**1. Порожня папка і скіл у ній**

```bash
mkdir myerp && cd myerp && curl --create-dirs -o .claude/skills/altera-new-app/SKILL.md https://raw.githubusercontent.com/IgorAIvanov/altera03/master/skills/src/altera-new-app/SKILL.md
```

У PowerShell:

```powershell
mkdir myerp; cd myerp; curl.exe --create-dirs -o .claude/skills/altera-new-app/SKILL.md https://raw.githubusercontent.com/IgorAIvanov/altera03/master/skills/src/altera-new-app/SKILL.md
```

**2. Запустити Claude Code у цій папці й попросити**

> Розгорни застосунок Altera. PostgreSQL — у Docker.

Агент спитає те, чого не можна вигадати (ім'я проєкту, звідки брати PostgreSQL), і доведе
до відкритого в браузері екрана входу. Ім'я проєкту — латиниця в нижньому регістрі: з нього
виводяться ім'я бази, роль і cookie сесії, тож два застосунки на одній машині мусять мати
різні імена.

**3. Далі — розробка**

Scaffold розкладає в застосунок прикладні скіли (`.claude/skills`) і `CLAUDE.md`, тож
подальші прохання — «додай довідник складів», «зроби документ надходження з табличною
частиною», «додай друковану форму» — агент виконує за правилами фреймворку. Що змінилося
між версіями фреймворку, лежить у застосунку файлом `FRAMEWORK-CHANGELOG.md`.

### Без агента

Ті самі кроки руками — [`docs/deployment.md`](docs/deployment.md): `deno run -A
jsr:@altera/create myerp`, `.env`, база, `deno install`, публікація SQL, перший
адміністратор. Розгортання на Deno Deploy — [`docs/deno-deploy.md`](docs/deno-deploy.md).

## Підключити агента до працюючої бази

Крім розробки, агент може працювати **в** обліковій системі від імені користувача:
переглядати довідники, створювати й проводити документи, друкувати. Для цього —
персональний токен (видається з браузера) і MCP-обгортка: [`mcp/README.md`](mcp/README.md).

## Цей репозиторій

Тут живуть фреймворк і демонстраційний застосунок, на якому він перевіряється:

```
app/      демо-застосунок: моделі, SQL, екрани
client/   ui-kit і клієнтський рантайм (@altera/client)
server/   backend-бібліотека та SQL ядра (@altera/server)
tools/    codegen, збірка й публікація SQL (@altera/tools)
create/   scaffold нового застосунку (@altera/create)
skills/   скіли агента (@altera/skills)
mcp/      MCP-обгортка над HTTP-API (@altera/mcp)
docs/     рішення, плани й пояснення
```

Запуск у репозиторії:

```bash
cp .env.example .env        # і заповнити паролі та секрети
deno task startdb
deno install
deno task sql:assemble && deno task sql:publish
deno task dev
```

Карта репозиторію, команди й інваріанти — у [`CLAUDE.md`](CLAUDE.md); план розвитку —
[`docs/development-plan.md`](docs/development-plan.md).

## Ліцензія

[MIT](LICENSE). Ліцензії сторонніх компонентів, що потрапляють у збірку, виводяться
автоматично — `THIRD-PARTY-NOTICES.md` поруч із бандлом і в пакеті `@altera/server`.
