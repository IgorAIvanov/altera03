// Generated from model sources. Do not edit manually.
// Ключі відмов, які оголошує модель — див. tools/generate-model-runtime-registry.ts.

export const agentModelRules: Record<string, string[]> = {
  "agent_note": ["core.agentNoteEmpty","core.agentNoteTopicIncomplete"],
  "audit_setting": ["auditSetting.unknownLevel","auditSetting.unknownModel"],
  "invoice": ["invoice.postNoAmount"],
  "manual_entry": ["manualEntry.lineNoAccount","manualEntry.postNoEntries"],
  "numerator": ["common.fieldRequired","numerator.orgPrefixMissing","numerator.unknownStrategy"],
  "print_template": ["common.fieldRequired"],
  "setting": ["setting.unknownKey"],
  "user": ["user.notFound","user.passwordSet","user.passwordTooShort"],
};

