import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DAY_MS = 86_400_000;
const DAYS = 180;
// The newest coffee came out this many days ago, so last month always includes its launch.
const LAUNCHED_DAYS_AGO = 40;

// Name, category, price in cents, and how often it sells compared with the others.
const PRODUCTS: Array<[string, string, number, number]> = [
  ["House Blend, 340 g", "Coffee", 1600, 10],
  ["Ethiopia Yirgacheffe, 340 g", "Coffee", 1900, 7],
  ["Colombia Huila, 340 g", "Coffee", 1800, 6],
  ["Espresso Blend, 340 g", "Coffee", 1800, 6],
  ["Sumatra Dark Roast, 340 g", "Coffee", 1700, 4],
  ["Swiss Water Decaf, 340 g", "Coffee", 1700, 3],
  ["Barrel-Aged Guatemala, 250 g", "Coffee", 2600, 14],
  ["Ceramic Pour-Over Dripper", "Brewing", 2800, 3],
  ["Gooseneck Kettle", "Brewing", 6500, 2],
  ["French Press, 1 L", "Brewing", 3500, 2.5],
  ["AeroPress", "Brewing", 4000, 2.5],
  ["Cold Brew Jar", "Brewing", 3000, 2],
  ["Hand Grinder", "Grinders", 8500, 1.5],
  ["Electric Burr Grinder", "Grinders", 16000, 1.2],
  ["Paper Filters, 100 pack", "Accessories", 800, 6],
  ["Digital Scale", "Accessories", 4500, 1.5],
  ["Travel Mug", "Accessories", 2500, 2],
  ["Milk Frother", "Accessories", 3000, 1.5],
];

const FIRST_NAMES = ["Ada", "Ben", "Chloe", "Diego", "Elena", "Femi", "Grace", "Hiro", "Ines", "Jonas", "Kira", "Liam", "Maya", "Noah", "Olu", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Victor", "Wen", "Yara", "Zoe"];
const LAST_NAMES = ["Abbott", "Brennan", "Castillo", "Dubois", "Eriksen", "Fischer", "Garcia", "Haddad", "Ito", "Jensen", "Kowalski", "Larsen", "Moreau", "Nakamura", "Okafor", "Patel", "Rossi", "Silva", "Tanaka", "Weber"];
const CITIES = ["Austin", "Berlin", "Chicago", "Denver", "Lisbon", "London", "Melbourne", "Montreal", "New York", "Portland", "San Francisco", "Seattle", "Tokyo", "Toronto"];

const SCHEMA = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  joined_at TEXT NOT NULL -- YYYY-MM-DD HH:MM:SS, UTC
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- Coffee, Brewing, Grinders, or Accessories
  price_cents INTEGER NOT NULL, -- current list price
  launched_at TEXT NOT NULL -- YYYY-MM-DD HH:MM:SS, UTC
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  ordered_at TEXT NOT NULL, -- YYYY-MM-DD HH:MM:SS, UTC
  status TEXT NOT NULL -- paid, shipped, delivered, refunded, or cancelled
);
CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL, -- what the customer paid for one, after any discount
  PRIMARY KEY (order_id, product_id)
);`;

// Builds the sample store: 160 customers, 18 products, and about six months of orders that end today.
// The random numbers come from a fixed seed, so every build has the same store, moved to end today.
export function makeStore(path: string): void {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  const random = seeded(42);
  const now = Date.now();
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString().slice(0, 19).replace("T", " ");

  db.exec(SCHEMA);
  db.exec("BEGIN");
  const addProduct = db.prepare("INSERT INTO products (name, category, price_cents, launched_at) VALUES (?, ?, ?, ?)");
  for (const [name, category, price] of PRODUCTS) {
    addProduct.run(name, category, price, at(name.startsWith("Barrel") ? LAUNCHED_DAYS_AGO : 400 + random() * 300));
  }

  // Some customers buy far more often than others, which gives "top customers" questions an answer.
  const customers = Array.from({ length: 160 }, (_, index) => {
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length + index) % LAST_NAMES.length];
    return { id: index + 1, name: `${first} ${last}`, joinedDaysAgo: Math.floor(random() ** 0.7 * 540), weight: 0.3 + random() ** 4 * 12 };
  });
  const addCustomer = db.prepare("INSERT INTO customers (id, name, email, city, joined_at) VALUES (?, ?, ?, ?, ?)");
  for (const { id, name, joinedDaysAgo } of customers) {
    addCustomer.run(id, name, `${name.toLowerCase().replace(" ", ".")}.${id}@example.com`, pick(CITIES, random), at(joinedDaysAgo + random()));
  }

  const addOrder = db.prepare("INSERT INTO orders (customer_id, ordered_at, status) VALUES (?, ?, ?)");
  const addItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)");
  for (let day = DAYS; day >= 1; day--) {
    // Orders grow over the half year and pick up on weekends.
    const weekend = [0, 6].includes(new Date(now - day * DAY_MS).getUTCDay());
    const count = Math.round((5 + 4 * (1 - day / DAYS)) * (weekend ? 1.3 : 1) * (0.7 + random() * 0.6));
    for (let n = 0; n < count; n++) {
      const daysAgo = day - random();
      const buyers = customers.filter((customer) => customer.joinedDaysAgo > daysAgo);
      const customer = weighted(buyers, (buyer) => buyer.weight, random);
      const { lastInsertRowid } = addOrder.run(customer.id, at(daysAgo), status(daysAgo, random));
      const lines = random() < 0.55 ? 1 : random() < 0.66 ? 2 : 3;
      const chosen = new Set<number>();
      while (chosen.size < lines) {
        const index = weighted(PRODUCTS.map((_, i) => i), (i) => (i === 6 && daysAgo > LAUNCHED_DAYS_AGO ? 0 : PRODUCTS[i][3]), random);
        chosen.add(index);
      }
      for (const index of chosen) {
        const quantity = random() < 0.8 ? 1 : random() < 0.75 ? 2 : 3;
        const discount = random() < 0.1 ? 0.85 : 1;
        addItem.run(lastInsertRowid, index + 1, quantity, Math.round(PRODUCTS[index][2] * discount));
      }
    }
  }
  db.exec("COMMIT");
  db.close();
}

function status(daysAgo: number, random: () => number): string {
  const roll = random();
  if (roll < 0.03) return "cancelled";
  if (daysAgo < 3) return "paid";
  if (daysAgo < 7) return "shipped";
  return roll < 0.07 ? "refunded" : "delivered";
}

function weighted<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  let roll = random() * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

// mulberry32, a small seeded random number generator.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
