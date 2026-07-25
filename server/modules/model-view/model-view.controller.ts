import { Controller, Get, Param } from "@danet/core";
import { err, ok } from "../../common/response.ts";
import { jsonResponse } from "../../common/http.ts";
import { ModelViewService } from "./model-view.service.ts";

/**
 * Резолв в'ю: маршрут → чанк, який його реалізує.
 *
 * Відповідає тим самим конвертом, що й команди моделей та авторизація. Раніше
 * цей контролер був єдиним винятком (`{ ok, chunkUrl, message }`), і клієнти
 * розбирали його окремою гілкою — рівно та плата за виняток, заради якої
 * конверт і заводили.
 */
@Controller("api/view")
export class ModelViewController {
  // GET /api/view/operation/supplier_invoice/edit
  constructor(private service: ModelViewService) {}

  @Get(":module/:model/:view")
  resolve(
    @Param("module") module: string,
    @Param("model") model: string,
    @Param("view") view: string,
  ) {
    const route = `${module}/${model}/${view}`;
    const entry = this.service.resolve(route);

    if (!entry) {
      // 404, а не 200 з `ok:false`: питали конкретний ресурс, і його немає.
      // Конверт при цьому той самий — статус і тіло не сперечаються.
      return jsonResponse(err(`В'ю не знайдено: ${route}`), 404);
    }

    return ok({ chunkUrl: entry.chunkUrl, titleKey: entry.titleKey ?? null });
  }
}
