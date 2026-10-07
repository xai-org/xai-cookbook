import { toCents } from "./money.js";

export function createCart() {
  return { items: [] };
}

// Adding a product that's already in the cart raises its quantity instead of adding a second line.
export function addItem(cart, product, quantity = 1) {
  const line = cart.items.find((item) => item.sku === product.sku);
  if (line) line.quantity += quantity;
  else cart.items.push({ sku: product.sku, name: product.name, unitCents: toCents(product.price), quantity });
  return cart;
}

export function removeItem(cart, sku) {
  cart.items = cart.items.filter((item) => item.sku !== sku);
  return cart;
}

export function subtotalCents(cart) {
  return cart.items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
}
