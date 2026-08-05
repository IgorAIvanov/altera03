// Заглушка. Перезаписує `deno task sql:registry`.
//
// Серверний бік реєстру моделей: тут статичні `import` модулів TS-команд
// (`manifest.commands.ts`), тому цей файл імпортує ТІЛЬКИ app/server.ts.
// Клієнт бере дані з model-registry.generated.ts — інакше кожна серверна
// команда їхала б у бандл клієнта разом з усім, що вона імпортує.
//
// Типи навмисно не виписані — див. коментар у model-registry.generated.ts.
export const generatedTsCommandBindings = [];
