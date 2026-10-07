import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const DAY_MS = 86_400_000;
const REFUND_WINDOW_DAYS = 30;
const POLICY = readFileSync(new URL("../refund-policy.md", import.meta.url), "utf8");
// Stand-ins for two outside systems: the payment provider's refunds and the email service's outbox.
// Both keep the idempotency key each request came with.
const REFUNDS = "output/refunds.log";
const OUTBOX = "output/outbox.log";

export type Item = { name: string; price: number; quantity: number; final_sale?: boolean; appliance?: boolean };
export type Order = {
  id: string;
  customer: { name: string; email: string };
  ordered_at: string;
  delivered_at: string;
  items: Item[];
  shipping: number;
  total: number;
  payment: string;
};
export type RefundArgs = { order_id: string; amount: number; reason: string };
export type Refund = RefundArgs & { id: string; key: string; payment: string; created_at: string };
export type Email = { id: string; key: string; to: string; message: string; sent_at: string };

// The sample orders give their dates in days before today, so each one stays inside or outside the
// refund window whenever you run it.
type SampleOrder = Omit<Order, "ordered_at" | "delivered_at"> & { ordered_days_ago: number; delivered_days_ago: number };
const ORDERS: Order[] = (JSON.parse(readFileSync(new URL("../orders.json", import.meta.url), "utf8")) as SampleOrder[]).map(
  ({ ordered_days_ago, delivered_days_ago, ...order }) => ({ ...order, ordered_at: daysAgo(ordered_days_ago), delivered_at: daysAgo(delivered_days_ago) }),
);

export function findOrder(id: string): Order | undefined {
  return ORDERS.find((order) => order.id === id.trim().toUpperCase());
}

export function lookupOrder(id: string) {
  const order = findOrder(id);
  if (!order) return { error: `There's no order ${id}.` };
  return { ...order, refunds: refundsFor(order.id).map(({ id, amount, created_at }) => ({ id, amount, created_at })) };
}

// The policy as written, plus the facts about the order that it turns on, so the model doesn't have
// to count days or add up earlier refunds itself.
export function checkRefundPolicy(id: string) {
  const order = findOrder(id);
  if (!order) return { error: `There's no order ${id}.` };
  const days = Math.floor((Date.now() - Date.parse(order.delivered_at)) / DAY_MS);
  return {
    policy: POLICY,
    order_id: order.id,
    days_since_delivery: days,
    within_refund_window: days <= REFUND_WINDOW_DAYS,
    final_sale_items: order.items.filter((item) => item.final_sale).map((item) => item.name),
    paid: order.total,
    refunded_so_far: cents(order.total - refundable(order)),
    refundable: refundable(order),
  };
}

// Why the refund can't be issued, if it can't. It's checked before anyone is asked to approve it, and
// again when it's issued, in case another refund for the order went through in between.
export function refundProblem({ order_id, amount }: RefundArgs): string | undefined {
  const order = findOrder(String(order_id));
  if (!order) return `There's no order ${order_id}.`;
  if (typeof amount !== "number" || !(amount > 0)) return "The amount has to be a number of dollars above 0.";
  const left = refundable(order);
  if (amount > left) return `Only $${left.toFixed(2)} of order ${order.id} is left to refund.`;
}

// The payment provider's side of an idempotent request: the first request with a key makes the
// refund, and any later request with the same key gets that refund back instead of a new one.
export function issueRefund(key: string, args: RefundArgs): { refund: Refund; replayed: boolean } | { error: string } {
  const existing = readLog<Refund>(REFUNDS).find((refund) => refund.key === key);
  if (existing) return { refund: existing, replayed: true };
  const problem = refundProblem(args);
  if (problem) return { error: problem };
  const order = findOrder(args.order_id) as Order;
  const refund: Refund = {
    id: `re_${randomUUID().slice(0, 8)}`,
    key,
    order_id: order.id,
    amount: cents(args.amount),
    reason: args.reason,
    payment: order.payment,
    created_at: new Date().toISOString(),
  };
  appendLog(REFUNDS, refund);
  return { refund, replayed: false };
}

// Doesn't send anything: the email only goes to output/outbox.log. It takes an idempotency key like
// a refund does, so a call that runs again doesn't email the customer twice.
export function sendEmail(key: string, to: string, message: string): Email {
  const existing = readLog<Email>(OUTBOX).find((email) => email.key === key);
  if (existing) return existing;
  const email = { id: `msg_${randomUUID().slice(0, 8)}`, key, to, message, sent_at: new Date().toISOString() };
  appendLog(OUTBOX, email);
  return email;
}

export function readLog<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

export function appendLog(file: string, entry: object): void {
  mkdirSync("output", { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function refundable(order: Order): number {
  return cents(order.total - refundsFor(order.id).reduce((sum, refund) => sum + refund.amount, 0));
}

function refundsFor(orderId: string): Refund[] {
  return readLog<Refund>(REFUNDS).filter((refund) => refund.order_id === orderId);
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
