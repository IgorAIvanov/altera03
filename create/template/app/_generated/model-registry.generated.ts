// Заглушка. Перезаписує `deno task sql:registry` — запусти його після створення
// першої моделі (app/<family>/<model>/manifest.json).
//
// Типи навмисно не виписані: порожні літерали приймаються обома контрактами
// bootstrap(), а анотація тут розійшлася б із фреймворком при першому ж
// уточненні його типів.
export const generatedModelRegistry = {};
export const generatedTsCommandBindings = [];
