// Prices are entered in dollars, like 19.99. Everything after that works in whole cents, so amounts
// add up exactly.
export function toCents(dollars) {
  return Math.floor(dollars * 100);
}

export function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const amount = Math.abs(cents);
  return `${sign}$${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}
