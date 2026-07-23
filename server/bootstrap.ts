import { DanetApplication } from "@danet/core";
import { AppModule } from "./app.module.ts";
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
  await application.init(AppModule);
  return application;
}
