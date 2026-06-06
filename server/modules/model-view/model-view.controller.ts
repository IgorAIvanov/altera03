import { Controller, Get, Param } from "@danet/core";
import { ModelViewService } from "./model-view.service.ts";

@Controller("api/view")
export class ModelViewController {
  constructor(private service: ModelViewService) {}

  // GET /api/view/operation/supplier_invoice/edit
  @Get(":module/:model/:view")
  resolve(
    @Param("module") module: string,
    @Param("model") model: string,
    @Param("view") view: string,
  ) {
    const route = `${module}/${model}/${view}`;
    const entry = this.service.resolve(route);

    if (!entry) {
      return { ok: false, message: `View not found: ${route}` };
    }

    return {
      ok: true,
      chunkUrl: entry.chunkUrl,
      titleKey: entry.titleKey ?? null,
    };
  }
}
