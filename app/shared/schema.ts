import { Type, type Static } from "@sinclair/typebox";

export const OptionRowSchema = Type.Object({
  id:   Type.String(),
  name: Type.String(),
});
export type OptionRow = Static<typeof OptionRowSchema>;

export const PagePayloadSchema = Type.Object({
  page:     Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
});
export type PagePayload = Static<typeof PagePayloadSchema>;

export const SortDirSchema = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);
export type SortDir = Static<typeof SortDirSchema>;
