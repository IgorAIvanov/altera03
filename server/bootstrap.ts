import { DanetApplication } from "@danet/core";
import { AppModule } from "./app.module.ts";
import { ApiExceptionFilter } from "./common/api-exception.filter.ts";
import { resolveServerConfig, setServerConfig, type ServerOptions } from "./config/server-config.ts";

/**
 * Піднімає сервер із переданою конфігурацією.
 *
 * Конфігурація застосовується ДО `init()`: сервіси читають її під час
 * bootstrap-хуків (пул БД, наприклад), тому пізніше було б запізно.
 */
export async function bootstrap(options: ServerOptions): Promise<DanetApplication> {
  setServerConfig(resolveServerConfig(options));

  const application = new DanetApplication();
  // До `init()`: фільтр має стояти раніше, ніж з'явиться перший запит, який
  // може впасти — зокрема раніше за bootstrap-хуки, що ходять у БД.
  application.useGlobalExceptionFilter(new ApiExceptionFilter());
  await application.init(AppModule);
  return application;
}
