import { DanetApplication } from "@danet/core";
import { AppModule } from "./app.module.ts";

export const bootstrap = async () => {
  const application = new DanetApplication();
  await application.init(AppModule);
  return application;
};
