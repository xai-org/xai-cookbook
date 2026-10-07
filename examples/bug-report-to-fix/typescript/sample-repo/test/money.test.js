import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCents, toCents } from "../src/money.js";

test("converts whole and half dollars to cents", () => {
  assert.equal(toCents(4), 400);
  assert.equal(toCents(12.5), 1250);
});

test("formats cents as dollars", () => {
  assert.equal(formatCents(1250), "$12.50");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(-499), "-$4.99");
});
