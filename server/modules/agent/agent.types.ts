export type AgentUiActionType = "openRoute" | "openList" | "showToast" | "focusField";

export interface AgentUiActionOpenRoute {
  type: "openRoute";
  route: string;       // /app/operation/supplier_invoice/42
  model: string;
  id: string;
}

export interface AgentUiActionOpenList {
  type: "openList";
  route: string;       // /app/operation/supplier_invoice
  model: string;
}

export interface AgentUiActionShowToast {
  type: "showToast";
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export interface AgentUiActionFocusField {
  type: "focusField";
  field: string;
  message?: string;
}

export type AgentUiAction =
  | AgentUiActionOpenRoute
  | AgentUiActionOpenList
  | AgentUiActionShowToast
  | AgentUiActionFocusField;

export interface AgentCommandResult {
  ok: boolean;
  model: string;
  command: string;
  id?: string;
  messages: string[];
  data?: unknown;
}

export interface AgentResponse {
  ok: boolean;
  result: AgentCommandResult | null;
  uiActions: AgentUiAction[];
  messages: string[];
}

export interface AgentChatRequest {
  model: string;
  command: string;
  payload: Record<string, unknown>;
}
