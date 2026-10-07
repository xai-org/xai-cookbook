---
name: fix-a-bug
description: How to reproduce and fix a bug in tiny-checkout, a store's cart, coupon, shipping, and total logic. Covers running the tests with node --test, where the code and tests live, and the steps and conventions every fix follows.
---

# Fixing a bug in tiny-checkout

tiny-checkout is the checkout logic of a small web store. It's plain JavaScript in ES modules with no dependencies, so there's nothing to install.

## Where things are

- `src/money.js` turns prices in dollars into whole cents and formats cents for display.
- `src/cart.js` keeps the cart's lines and adds up the subtotal.
- `src/coupons.js` looks up coupon codes and works out their discount.
- `src/checkout.js` puts it together: subtotal, shipping, discount, and total.
- `test/<name>.test.js` has the tests for `src/<name>.js`.

## Running the tests

- Every test: `node --test`
- One file: `node --test test/money.test.js`

The output lists each test with ✔ or ✖, then a summary. A failing test shows the expected and actual values.

## Steps

1. Run `node --test` to see where things stand before you change anything.
2. Find the code behind the symptom. Start from what the report describes, read the files involved, and follow the calls with `grep -rn`.
3. Add a test that reproduces the report to the test file of the module you'll fix, and run it to watch it fail. A fix without a failing test first isn't done.
4. Fix the cause, not the symptom, with the smallest change that works.
5. Run `node --test` again, and keep going until every test passes.
6. Finish with two or three sentences on what was wrong and what you changed.

## Conventions

- Amounts are whole cents everywhere. Dollars become cents once, in `toCents()`, when a product goes into the cart.
- Tests use `node:test` and `node:assert/strict`, with one `test()` per behavior, named after the behavior in plain words, like the existing ones.
- Keep the style of the file you're editing: two-space indents, double quotes, semicolons.
- Don't add dependencies or change `package.json`.
