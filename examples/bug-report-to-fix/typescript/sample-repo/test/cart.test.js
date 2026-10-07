import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, createCart, removeItem, subtotalCents } from "../src/cart.js";

const MUG = { sku: "mug", name: "Enamel mug", price: 12.5 };
const PENCILS = { sku: "pencils", name: "Pencil set", price: 4 };

test("adds up the subtotal of every line", () => {
  const cart = createCart();
  addItem(cart, MUG, 2);
  addItem(cart, PENCILS);
  assert.equal(subtotalCents(cart), 2900);
});

test("adding the same product again raises its quantity", () => {
  const cart = createCart();
  addItem(cart, MUG);
  addItem(cart, MUG, 2);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 3);
});

test("removes a product from the cart", () => {
  const cart = createCart();
  addItem(cart, MUG);
  addItem(cart, PENCILS);
  removeItem(cart, "mug");
  assert.deepEqual(cart.items.map((item) => item.sku), ["pencils"]);
});
