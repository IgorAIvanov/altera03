// Generated from model manifests. Do not edit manually.

export interface AgentModelRoute {
  editPath?: string;
  listPath?: string;
  type: string;
  allow?: boolean;
  allowCommands?: string[];
  aliases?: string[];
  priority?: number;
}

export const agentModelRoutes: Record<string, AgentModelRoute> = {
  "bank": {
    editPath: "/catalog/bank/edit",
    listPath: "/catalog/bank/list",
    type: "catalog"
  },
  "interface": {
    editPath: "/admin/interface/edit",
    listPath: "/admin/interface/list",
    type: "admin"
  },
  "print_template": {
    editPath: "/admin/print_template/edit",
    listPath: "/admin/print_template/list",
    type: "admin"
  },
  "user": {
    editPath: "/admin/user/edit",
    listPath: "/admin/user/list",
    type: "admin"
  },
  "user_group": {
    editPath: "/admin/user_group/edit",
    listPath: "/admin/user_group/list",
    type: "admin"
  }
};

