export interface ViewEntry {
  route: string;      // "operation/supplier_invoice/edit"
  chunkUrl: string;   // "/assets/supplierInvoiceCardPage-Bc3dKs2.js" | "http://localhost:5173/..."
  titleKey?: string;
}

export interface ViewManifest {
  model: string;
  views?: Record<string, {
    module: string;
    titleKey?: string;
  }>;
}

// Формат dist/.vite/manifest.json
export type ViteManifest = Record<string, { file: string; isEntry?: boolean }>;
