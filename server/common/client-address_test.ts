import { assertEquals } from "@std/assert";
import { normalizeClientAddress } from "./client-address.ts";

Deno.test("адреса клієнта: IPv4 як є, петля — невідома", () => {
  assertEquals(normalizeClientAddress("203.0.113.7"), "203.0.113.7");
  assertEquals(normalizeClientAddress(" 203.0.113.7:51234 "), "203.0.113.7");
  assertEquals(normalizeClientAddress("127.0.0.1"), null);
  assertEquals(normalizeClientAddress(""), null);
  assertEquals(normalizeClientAddress("not-an-address"), null);
});

// Головне, заради чого нормалізація існує: абонент IPv6 має цілу /64, і
// лічильник на окрему адресу атака обходила б, міняючи її щоразу.
Deno.test("адреса клієнта: IPv6 зводиться до мережі /64", () => {
  const a = normalizeClientAddress("2001:db8:abcd:12:1::5");
  const b = normalizeClientAddress("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff");
  assertEquals(a, "2001:db8:abcd:12::/64");
  assertEquals(b, a);
  assertEquals(normalizeClientAddress("[2001:db8:abcd:12::1]:443"), a);
  assertEquals(normalizeClientAddress("fe80::1%eth0"), "fe80:0:0:0::/64");
  assertEquals(normalizeClientAddress("::1"), null);
  assertEquals(normalizeClientAddress("::ffff:198.51.100.4"), "198.51.100.4");
  assertEquals(normalizeClientAddress("1:2:3:4:5:6:7:8:9"), null);
});
