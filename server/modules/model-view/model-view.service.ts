import { Injectable } from "@danet/core";
import { buildViewRegistry } from "./model-view.registry.ts";
import type { ViewEntry } from "./model-view.types.ts";

@Injectable()
export class ModelViewService {
  private registry = new Map<string, ViewEntry>();

  async onAppBootstrap() {
    this.registry = await buildViewRegistry();
  }

  resolve(route: string): ViewEntry | null {
    return this.registry.get(route) ?? null;
  }

  all(): ViewEntry[] {
    return Array.from(this.registry.values());
  }
}
