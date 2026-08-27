/// <reference lib="deno.ns" />
/**
 * Проби розгортки дерева елементів: `deno task test:unit`.
 *
 * Перевіряється саме те, що ламається тихо: порядок обходу, глибина, доля
 * рядка без батька в наборі та цикл у даних — жоден із цих випадків не падає,
 * він просто малює не те дерево.
 */
import { assertEquals } from "@std/assert";
import { flattenTree, treeParentIndex } from "./tree-contract.ts";

interface R {
  id: string;
  parentId: string | null;
}

const row = (id: string, parentId: string | null = null): R => ({ id, parentId });
const parentOf = (r: R) => r.parentId;
const none = () => false;

/** Компактний знімок результату: "id:глибина[+]" ( + — має дітей). */
function shape(nodes: ReturnType<typeof flattenTree<R>>): string[] {
  return nodes.map((n) => `${n.row.id}:${n.depth}${n.hasChildren ? "+" : ""}`);
}

Deno.test("плоский набір без батьків — усі корені в порядку входу", () => {
  const nodes = flattenTree([row("a"), row("b"), row("c")], parentOf, none);
  assertEquals(shape(nodes), ["a:0", "b:0", "c:0"]);
});

Deno.test("діти йдуть за батьком, глибина росте, порядок siblings — порядок входу", () => {
  // Вхід «відсортований глобально»: діти не стоять поруч із батьком.
  const rows = [row("shop2"), row("shop1"), row("s11", "shop1"), row("s21", "shop2"), row("s12", "shop1")];
  const nodes = flattenTree(rows, parentOf, none);
  assertEquals(shape(nodes), ["shop2:0+", "s21:1", "shop1:0+", "s11:1", "s12:1"]);
});

Deno.test("третій рівень: глибина 2, hasChildren лише в тих, у кого діти в наборі", () => {
  const rows = [row("a"), row("b", "a"), row("c", "b")];
  const nodes = flattenTree(rows, parentOf, none);
  assertEquals(shape(nodes), ["a:0+", "b:1+", "c:2"]);
});

Deno.test("згорнутий вузол ховає піддерево цілком, сам лишається", () => {
  const rows = [row("a"), row("b", "a"), row("c", "b"), row("d")];
  const nodes = flattenTree(rows, parentOf, (id) => id === "a");
  assertEquals(shape(nodes), ["a:0+", "d:0"]);
});

Deno.test("згорнутість глибше за поверхню: ховається гілка, не сусіди", () => {
  const rows = [row("a"), row("b", "a"), row("c", "b"), row("e", "a")];
  const nodes = flattenTree(rows, parentOf, (id) => id === "b");
  assertEquals(shape(nodes), ["a:0+", "b:1+", "e:1"]);
});

Deno.test("рядок без батька в наборі підіймається в корінь, а не зникає", () => {
  // Батько відфільтрований (позначений, за стелею вибірки) — дитина видима.
  const rows = [row("a"), row("orphan", "missing")];
  const nodes = flattenTree(rows, parentOf, none);
  assertEquals(shape(nodes), ["a:0", "orphan:0"]);
});

Deno.test("порожній parentId — те саме, що null", () => {
  const rows = [{ id: "a", parentId: "" as string | null }, row("b", "a")];
  const nodes = flattenTree(rows, parentOf, none);
  assertEquals(shape(nodes), ["a:0+", "b:1"]);
});

Deno.test("цикл у даних не вішає обхід і не губить рядків", () => {
  // a→b→a: шляху з кореня немає; обидва мусять бути видимі.
  const rows = [row("ok"), row("a", "b"), row("b", "a"), row("c", "b")];
  const nodes = flattenTree(rows, parentOf, none);
  const ids = nodes.map((n) => n.row.id).sort();
  assertEquals(ids, ["a", "b", "c", "ok"]);
  // Перший учасник циклу (за порядком входу) стає коренем свого піддерева.
  assertEquals(shape(nodes)[0], "ok:0");
  assertEquals(shape(nodes).slice(1), ["a:0+", "b:1+", "c:2"]);
});

Deno.test("сам собі батько — вироджений цикл, рядок видимий", () => {
  const nodes = flattenTree([row("x", "x")], parentOf, none);
  assertEquals(shape(nodes), ["x:0+"]);
});

Deno.test("treeParentIndex нормалізує: порожній і відсутній у наборі батько — null", () => {
  const rows = [row("a"), { id: "b", parentId: "" as string | null }, row("c", "missing"), row("d", "a")];
  const parents = treeParentIndex(rows, parentOf);
  assertEquals(parents.get("a"), null);
  assertEquals(parents.get("b"), null);
  assertEquals(parents.get("c"), null);
  assertEquals(parents.get("d"), "a");
  assertEquals(parents.has("missing"), false);
});

Deno.test("flattenTree і treeParentIndex бачать батьків однаково", () => {
  const rows = [row("a"), row("b", "a"), row("orphan", "ghost")];
  const parents = treeParentIndex(rows, parentOf);
  const roots = flattenTree(rows, parentOf, none).filter((n) => n.depth === 0).map((n) => n.row.id);
  const rootsByIndex = rows.filter((r) => parents.get(r.id) === null).map((r) => r.id);
  assertEquals(roots, rootsByIndex);
});
