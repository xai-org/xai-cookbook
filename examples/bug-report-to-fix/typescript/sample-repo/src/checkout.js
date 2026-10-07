import { subtotalCents } from "./cart.js";
import { discountCents, findCoupon } from "./coupons.js";

// Orders of $50 or more ship free, going by the subtotal before any coupon.
export const FREE_SHIPPING_FROM_CENTS = 5000;
export const SHIPPING_CENTS = 499;

export function shippingCents(subtotal) {
  return subtotal > FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
}

// Coupons take money off the items in the cart. Shipping is always charged in full.
export function checkout(cart, { coupon: code } = {}) {
  const subtotal = subtotalCents(cart);
  const shipping = shippingCents(subtotal);
  const coupon = code ? findCoupon(code) : null;
  const discount = discountCents(coupon, subtotal + shipping);
  return { subtotal, shipping, discount, total: subtotal + shipping - discount };
}
