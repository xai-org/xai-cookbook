const COUPONS = {
  SAVE10: { type: "percent", percent: 10 },
  WELCOME5: { type: "fixed", cents: 500 },
};

// Codes are matched in upper case, since customers type them however they like.
export function findCoupon(code) {
  return COUPONS[code.trim().toUpperCase()] ?? null;
}

export function discountCents(coupon, amountCents) {
  if (!coupon) return 0;
  if (coupon.type === "percent") return Math.round((amountCents * coupon.percent) / 100);
  return Math.min(coupon.cents, amountCents);
}
