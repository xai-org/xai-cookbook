import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, createCart } from "../src/cart.js";
import { checkout } from "../src/checkout.js";

function cartOf(price, quantity = 1) {
  return addItem(createCart(), { sku: "item", name: "Item", price }, quantity);
}

test("charges shipping below $50", () => {
  assert.deepEqual(checkout(cartOf(20)), { subtotal: 2000, shipping: 499, discount: 0, total: 2499 });
});

test("ships free above $50", () => {
  assert.deepEqual(checkout(cartOf(30, 2)), { subtotal: 6000, shipping: 0, discount: 0, total: 6000 });
});

test("takes a fixed coupon off the order", () => {
  assert.deepEqual(checkout(cartOf(20), { coupon: "WELCOME5" }), { subtotal: 2000, shipping: 499, discount: 500, total: 1999 });
});

test("takes a percentage coupon off an order that ships free", () => {
  assert.deepEqual(checkout(cartOf(30, 2), { coupon: "SAVE10" }), { subtotal: 6000, shipping: 0, discount: 600, total: 5400 });
});

test("ignores a coupon that doesn't exist", () => {
  assert.equal(checkout(cartOf(20), { coupon: "FREESTUFF" }).discount, 0);
});
