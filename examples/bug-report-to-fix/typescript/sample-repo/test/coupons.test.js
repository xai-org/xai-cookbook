import assert from "node:assert/strict";
import { test } from "node:test";
import { discountCents, findCoupon } from "../src/coupons.js";

test("finds a coupon however it's typed", () => {
  assert.deepEqual(findCoupon(" save10 "), { type: "percent", percent: 10 });
  assert.equal(findCoupon("NOPE"), null);
});

test("takes a percentage off, rounded to the cent", () => {
  assert.equal(discountCents(findCoupon("SAVE10"), 2995), 300);
});

test("never takes off more than the amount", () => {
  assert.equal(discountCents(findCoupon("WELCOME5"), 300), 300);
});
