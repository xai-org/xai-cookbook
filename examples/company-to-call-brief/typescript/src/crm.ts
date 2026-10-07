import { readFileSync } from "node:fs";
import type { Tool } from "@xai-official/sdk";

type Contact = { name: string; title: string; role: string; email: string; phone: string; last_contact: string };
type Meeting = { date: string; type: string; attendees: string[]; notes: string };
type Deal = { name: string; stage: string; amount: number; close_date: string; next_step: string; discount_floor: number };
type Ticket = { id: string; subject: string; priority: string; status: string; opened: string };
type Account = {
  id: string;
  name: string;
  domain: string;
  stage: string;
  plan: string | null;
  arr: number;
  customer_since: string | null;
  renewal_date: string | null;
  owner: string;
  contacts: Contact[];
  meetings: Meeting[];
  deals: Deal[];
  tickets: Ticket[];
};

const CRM = JSON.parse(readFileSync(new URL("../crm.json", import.meta.url), "utf8")) as { seller: string; accounts: Account[] };

export const SELLER = CRM.seller;
export const ACCOUNTS = CRM.accounts.map((account) => account.name);

// A function call Grok made and what your app sent back. `withheld` names what stayed in the CRM.
export type Lookup = { name: string; args: unknown; result: unknown; summary: string; withheld?: string };

const ACCOUNT_ID = { account_id: { type: "string", description: "The account's id from find_account" } };

export const CRM_TOOLS: Tool[] = [
  tool("find_account", "Find a company in our CRM by name or domain. Returns its account id, stage, plan, revenue, and owner.", {
    company: { type: "string", description: "The company's name or domain" },
  }),
  tool("get_contacts", "List our contacts at an account, with their titles and roles.", ACCOUNT_ID),
  tool("get_meetings", "List our past meetings with an account, newest first, with notes.", ACCOUNT_ID),
  tool("get_deals", "List an account's deals, with stage, amount, close date, and next step.", ACCOUNT_ID),
  tool("get_tickets", "List an account's support tickets, with priority and status.", ACCOUNT_ID),
];

// Each lookup picks the fields Grok may see, so anything not listed here, like contacts' emails and phone
// numbers or the lowest discount we'd accept, never leaves your app.
const LOOKUPS: Record<string, (args: Record<string, unknown>) => Omit<Lookup, "name" | "args">> = {
  find_account: (args) => {
    const company = stringArg(args, "company");
    const account = findAccount(company);
    if (!account) return { result: { error: `There's no account for ${company} in the CRM.` }, summary: "Not in the CRM" };
    const { id, name, domain, stage, plan, arr, customer_since, renewal_date, owner } = account;
    return {
      result: { account_id: id, name, domain, stage, plan, arr, customer_since, renewal_date, owner },
      summary: [name, stage, plan].filter(Boolean).join(" · "),
    };
  },
  get_contacts: (args) => {
    const contacts = getAccount(args).contacts.map(({ name, title, role, last_contact }) => ({ name, title, role, last_contact }));
    return { result: contacts, summary: plural(contacts.length, "contact"), withheld: "Emails and phone numbers" };
  },
  get_meetings: (args) => {
    const meetings = getAccount(args).meetings.map(({ date, type, attendees, notes }) => ({ date, type, attendees, notes }));
    return { result: meetings, summary: plural(meetings.length, "meeting") };
  },
  get_deals: (args) => {
    const deals = getAccount(args).deals.map(({ name, stage, amount, close_date, next_step }) => ({ name, stage, amount, close_date, next_step }));
    return { result: deals, summary: plural(deals.length, "deal"), withheld: "Discount floors" };
  },
  get_tickets: (args) => {
    const tickets = getAccount(args).tickets.map(({ id, subject, priority, status, opened }) => ({ id, subject, priority, status, opened }));
    const open = tickets.filter((ticket) => ticket.status === "Open").length;
    return { result: tickets, summary: `${plural(tickets.length, "ticket")}, ${open} open` };
  },
};

// Runs a function call from Grok, with its arguments as the JSON string Grok wrote. Errors go back to Grok as the
// result, so it can recover.
export function lookUp(name: string, json: string): Lookup {
  let args: unknown = json;
  try {
    args = JSON.parse(json);
    const lookup = LOOKUPS[name];
    if (!lookup) throw new Error(`There's no function named ${name}.`);
    if (typeof args !== "object" || args === null) throw new Error("The arguments must be an object.");
    return { name, args, ...lookup(args as Record<string, unknown>) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, args, result: { error: message }, summary: message };
  }
}

// Matches "Stripe", "stripe.com", and "Stripe, Inc." alike.
function findAccount(company: string): Account | undefined {
  const key = company.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[^a-z0-9.]+/g, " ").trim();
  return CRM.accounts.find((account) => {
    const name = account.name.toLowerCase();
    return key === name || key === account.domain || key.startsWith(`${name} `);
  });
}

function getAccount(args: Record<string, unknown>): Account {
  const id = stringArg(args, "account_id");
  const found = CRM.accounts.find((account) => account.id === id);
  if (!found) throw new Error(`There's no account with the id ${id}. Call find_account first.`);
  return found;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a string.`);
  return value.trim();
}

function tool(name: string, description: string, properties: Record<string, object>): Tool {
  return {
    type: "function",
    name,
    description,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
