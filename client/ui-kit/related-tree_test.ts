/// <reference lib="deno.ns" />
/**
 * Псевдографіка дерева пов'язаних документів.
 *
 * Помилка тут не падає, а тихо малює не те: «└─» там, де нижче ще брат, або
 * лінія, що обривається посеред гілки. Тому проба дивиться на весь малюнок
 * цілком — так його читає людина.
 */
import { assertEquals } from "@std/assert";
import { type RelatedNode, treePrefixes } from "./related-tree.ts";

function node(key: number, parentKey: number | null, depth: number, number: string): RelatedNode {
  return {
    key,
    parentKey,
    depth,
    number,
    isCurrent: false,
    isRepeat: false,
    isAvailable: true,
    typeCode: "invoice",
    typeName: "Накл.",
    id: String(key),
    docDate: null,
    total: null,
    presentation: null,
    isPosted: false,
    isDeleted: false,
    viaModel: null,
    viaField: null,
  };
}

function draw(rows: RelatedNode[]): string[] {
  const prefixes = treePrefixes(rows);
  return rows.map((row, index) => prefixes[index] + row.number);
}

Deno.test("дерево: лінія предка тягнеться, поки в нього є брати нижче", () => {
  assertEquals(
    draw([
      node(1, null, 0, "A"),
      node(2, 1, 1, "B"),
      node(3, 2, 2, "D"),
      node(4, 2, 2, "E"),
      node(5, 1, 1, "C"),
      node(6, 5, 2, "F"),
    ]),
    [
      "A",
      "├─ B",
      "│  ├─ D",
      "│  └─ E",
      "└─ C",
      "   └─ F",
    ],
  );
});

Deno.test("дерево: кілька коренів — окремі дерева без спільної лінії", () => {
  assertEquals(
    draw([
      node(1, null, 0, "A"),
      node(2, 1, 1, "B"),
      node(3, null, 0, "X"),
      node(4, 3, 1, "Y"),
    ]),
    ["A", "└─ B", "X", "└─ Y"],
  );
});

Deno.test("дерево: самотній документ — без жодної гілки", () => {
  assertEquals(draw([node(1, null, 0, "A")]), ["A"]);
});
