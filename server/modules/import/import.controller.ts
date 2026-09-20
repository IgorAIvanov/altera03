/**
 * HTTP-межа каналу приймання.
 *
 * Два боки, і вони не схожі:
 *
 *   - **наш** — сесію заводить людина, і робить це ЗВИЧАЙНОЮ командою моделі
 *     (`import_session.start`), а не входом сюди: право на це має рахуватися
 *     там само, де права на все інше. Тут його немає навмисно;
 *   - **адаптера** (решта) — чужий процес із чужої машини, що ходить токеном
 *     з областю дії. Прав людини він не має; сесію називає сам токен.
 *
 * Окремий контролер, а не команди моделі, з тієї самої причини, що в байтів
 * вкладень: сюди їде тіло на мегабайти з хешем у заголовку, і конверт моделі
 * тут ні до чого — відповідь читає машина.
 */
import { Body, Controller, Get, Param, Post, Put, Req } from "@danet/core";
import {
  AuthenticationRequiredError,
  type HttpRequest,
  jsonResponse,
} from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import { ImportChannelError, ImportService } from "./import.service.ts";

function fail(error: unknown) {
  const status = error instanceof ImportChannelError
    ? error.status
    : error instanceof AuthenticationRequiredError
    ? 401
    : 500;
  const message = error instanceof Error ? error.message : "помилка каналу перенесення";
  return jsonResponse({ ok: false, error: message }, status);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Сесія цього запиту — з області дії токена.
 *
 * Тобто адаптер не називає сесію сам і назвати чужу не може: номер приїхав
 * разом із обліковими даними.
 *
 * Функцією ПОЗА класом, а не приватним методом: Danet вважає маршрутом кожен
 * метод прототипу, і метод без декоратора валить реєстрацію роутера цілком —
 * «Cannot read properties of undefined (reading 'length')» на старті, без
 * жодної згадки про те, який саме метод винен. Та сама граблина вже описана в
 * blob.controller.ts.
 */
async function channelSession(
  users: RequestUserService,
  importService: ImportService,
  req: HttpRequest,
): Promise<string> {
  const auth = await users.resolveAuthContext(req);
  return importService.sessionFromScope(auth.accessToken?.scope);
}

@Controller("api/import")
export class ImportController {
  constructor(
    private requestUserService: RequestUserService,
    private importService: ImportService,
  ) {}

  /**
   * Обмін коду на токен. ЄДИНИЙ вхід каналу без автентифікації.
   *
   * Інакше канал нічим було б почати: у адаптера є рівно те, що людина
   * прочитала з екрана. Захист тут не в автентифікації, а в самому коді:
   * одноразовий, живе хвилини, гасить себе тим самим запитом, що й обмінює.
   */
  @Post("pair")
  async pair(@Body() body: unknown) {
    try {
      const payload = asRecord(body);
      const result = await this.importService.pair(
        String(payload.code ?? ""),
        payload.passport ? asRecord(payload.passport) : null,
      );
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      return fail(error);
    }
  }

  /** Дозапит плану за фактом того, що вже прийнято. */
  @Get("plan/next")
  async planNext(@Req() req: HttpRequest) {
    try {
      const session = await channelSession(this.requestUserService, this.importService, req);
      return jsonResponse({ ok: true, plan: await this.importService.plan(session) });
    } catch (error) {
      return fail(error);
    }
  }

  /** Відкрити партію під пункт плану. */
  @Post("batches")
  async openBatch(@Req() req: HttpRequest, @Body() body: unknown) {
    try {
      const session = await channelSession(this.requestUserService, this.importService, req);
      const payload = asRecord(body);
      const id = await this.importService.openBatch(
        session,
        String(payload.query ?? ""),
        payload.passport ? asRecord(payload.passport) : null,
      );
      return jsonResponse({ ok: true, id });
    } catch (error) {
      return fail(error);
    }
  }

  /**
   * Частина пакета: тіло — JSON `{ items: [...] }`, хеш — заголовком.
   *
   * Тіло читається СИРИМИ БАЙТАМИ (`req.raw.arrayBuffer()`), бо саме по них
   * рахується sha256: відтворити точний текст, який сформував адаптер, ми не
   * можемо, а байти — можемо.
   */
  @Put("batches/:id/parts/:part")
  async putPart(
    @Req() req: HttpRequest,
    @Param("id") id: string,
    @Param("part") part: string,
  ) {
    try {
      const session = await channelSession(this.requestUserService, this.importService, req);
      const declared = req.header("x-part-sha256") ?? "";
      if (!declared) throw new ImportChannelError(400, "немає заголовка x-part-sha256");

      const body = new Uint8Array(await req.raw.arrayBuffer());
      const result = await this.importService.putPart(
        session,
        id,
        Number(part),
        body,
        declared,
      );
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      return fail(error);
    }
  }

  /** Підсумок партії: скільки частин і рядків обіцяв адаптер. */
  @Post("batches/:id/done")
  async finishBatch(@Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown) {
    try {
      const session = await channelSession(this.requestUserService, this.importService, req);
      const payload = asRecord(body);
      const toCount = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : null;

      const result = await this.importService.finishBatch(
        session,
        id,
        toCount(payload.parts),
        toCount(payload.rows),
        payload.error ? String(payload.error) : null,
      );
      return jsonResponse(result);
    } catch (error) {
      return fail(error);
    }
  }

  /** Стан партії — адаптер питає після обриву, що дослати. */
  @Get("batches/:id")
  async batchState(@Req() req: HttpRequest, @Param("id") id: string) {
    try {
      const session = await channelSession(this.requestUserService, this.importService, req);
      return jsonResponse(await this.importService.batchState(session, id));
    } catch (error) {
      return fail(error);
    }
  }
}
