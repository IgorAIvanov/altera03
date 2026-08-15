# Образ ФРЕЙМВОРКУ, а не застосунку разом із рішенням.
#
# Усередині все, крім прикладного рішення: Deno, карта імпортів із пінами,
# `vendor/`, `node_modules/`, каркасні `scripts/`, `vite.config.ts`,
# `tsconfig.json`. Саме рішення (`app/`) і продукти його збірки (`dist/`)
# живуть на томі — їх кладе `solution:update`.
#
# Звідси два незалежні шляхи оновлення, і це головна вигода розкладки:
#   нове рішення     → розпакувати на том і зібрати, образ той самий;
#   новий фреймворк  → замінити образ, том той самий.
#
# **Заміна образу ВИМАГАЄ перезбірки.** На томі лишаються `dist/` і
# `app/_sqlpackage/`, зібрані попередньою версією фреймворку: у першому вбитий
# його клієнтський код, у другому — SQL ядра. Піднявши новий образ без
# перезбірки, дістанете сервер однієї версії з бандлом і схемою від іншої.
# Розходження видно командою `deno task solution:status` — манифест поставки
# несе піни, якими артефакти зібрані.
#
#   docker compose --profile prod build
#   docker compose --profile prod run --rm update /srv/packages/erp-1.2.0.tar.gz
#   docker compose --profile prod up -d app

FROM denoland/deno:2.9.4 AS build
WORKDIR /srv

# Кеш Deno всередині проєкту, щоб його можна було перенести в рантайм-шар одним
# COPY. Без нього образ на старті йде в registry.npmjs.org по метадані пакетів —
# у закритому контурі це просто не працює, а в звичайному робить старт залежним
# від чужої доступності.
ENV DENO_DIR=/srv/.deno-cache

# `deno.*`, а не `deno.json deno.lock`: у свіжому застосунку файлу блокування ще
# немає (його створює `deno install`), а COPY на відсутній шлях валить збірку.
#
# **`deno.lock` мати треба.** Без нього Deno резолвить версії наново при кожному
# запуску — і на щойно опублікованій версії фреймворку впирається в політику
# мінімального віку залежності («Could not find version … newer than the
# specified minimum dependency date»). Причому не на збірці образу, а в
# РАНТАЙМІ, тобто там, де це схоже на зламаний застосунок. З файлом блокування
# питання не виникає взагалі. Перед складанням образу: `deno install`.
COPY deno.* tsconfig.json vite.config.ts ./
COPY scripts/ ./scripts/

# Свіжий реліз фреймворку Deno не бере добу («Could not find version …»), і
# всередині образу це виглядає так, ніби пакета немає взагалі. Прапорець
# окремим аргументом, а не зашитий: він послаблює захист від атак на ланцюжок
# постачання, тож умикати його має той, хто знає, що версія щойно вийшла:
#
#   docker compose --profile prod build --build-arg DENO_INSTALL_FLAGS=--min-dep-age=0
ARG DENO_INSTALL_FLAGS=

# `--env-file=.env` стоїть у задачах фронтенду, і без файлу вони не стартують.
# Порожній файл тут навмисний: секрети приходять оточенням контейнера, а
# запечений у шар `.env` лишився б в образі назавжди.
RUN touch .env && deno install --allow-scripts $DENO_INSTALL_FLAGS

# `app/` копіюється ЛИШЕ щоб прогріти граф: у рантайм-шар воно не поїде, а на
# його місце стане том. Без цього кроку `vendor/` неповний — карта імпортів не
# знає про прямі специфікатори в коді (`jsr:@std/http@…` в `app/server.ts`), і
# контейнер на кожному старті йшов би в мережу, а в закритому контурі не
# піднявся б узагалі.
COPY app/ ./app/
RUN deno install --allow-scripts $DENO_INSTALL_FLAGS --entrypoint ./app/server.ts

# Інструменти — окремо й «як вийде»: оновлення тягне `jsr:@altera/tools@…`, і
# без кешу перший `solution:update` полізе в мережу. Збірку це валити не має
# (версія могла ще не з'явитися в реєстрі), але й мовчати не можна.
RUN deno cache $DENO_INSTALL_FLAGS "jsr:@altera/tools@0.13.16/update-solution" \
 || echo "⚠ інструменти не закешовані — перше оновлення піде в мережу"

# ── Рантайм ──────────────────────────────────────────────────────────────────
FROM denoland/deno:2.9.4
WORKDIR /srv
ENV DENO_DIR=/srv/.deno-cache

COPY --from=build /srv/deno.json /srv/deno.lock /srv/tsconfig.json /srv/vite.config.ts ./
COPY --from=build /srv/scripts/ ./scripts/
COPY --from=build /srv/vendor/ ./vendor/
COPY --from=build /srv/node_modules/ ./node_modules/
COPY --from=build /srv/.deno-cache/ ./.deno-cache/

# `app/` і `dist/` НЕ копіюються: їх дає том. Порожні каталоги створюються, щоб
# монтування не створювало їх від root.
RUN mkdir -p /srv/app /srv/dist

EXPOSE 3000

# Дозволів рівно стільки, скільки треба серверу, — ні --allow-write, ні
# --allow-run. Оновлення робить окрема служба `update` тим самим образом, і
# ширші права належать ЇЙ, а не тому процесу, що приймає трафік.
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "./app/server.ts"]
