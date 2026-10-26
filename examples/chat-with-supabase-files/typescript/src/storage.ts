import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { BUCKET, TYPES, supabaseEnv } from "./config.ts";
import { extname } from "node:path";

export type Db = SupabaseClient;
export type StoredFile = { name: string; path: string; size: number; type: string; updatedAt: string };
export type Read = { id: string; object_name: string; mode: string; url_expires_at: string | null; question: string; created_at: string };

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// A client with no user, which sees only what the policies give to the anon role: nothing in this app.
export function anon(): Db {
  const env = supabaseEnv();
  return createClient(env.url, env.publishableKey, options);
}

// A client that acts as one user. Storage and the database evaluate every policy against this user's
// token, so the app never needs a key that skips them.
export function userClient(token: string): Db {
  const env = supabaseEnv();
  return createClient(env.url, env.publishableKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function signIn(email: string, password: string): Promise<{ token: string; userId: string; email: string }> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Sign in failed");
  return { token: data.session.access_token, userId: data.user.id, email: data.user.email ?? email };
}

export class AuthError extends Error {}

// The user's id, from the token's signed claims.
export async function userIdFrom(token: string): Promise<string> {
  const db = anon();
  const claims = await db.auth.getClaims(token);
  if (claims.data?.claims.sub && !claims.error) return claims.data.claims.sub;
  const user = await db.auth.getUser(token);
  if (user.data.user && !user.error) return user.data.user.id;
  throw new AuthError("Sign in again.");
}

// Names become part of an object path and, in upload mode, a filename Grok sees, so they're kept to plain characters.
export function safeName(name: string): string {
  const ext = extname(name).toLowerCase();
  const stem = name
    .slice(0, name.length - ext.length)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 100 - ext.length);
  return `${stem || "file"}${ext}`;
}

export async function listFiles(db: Db, userId: string): Promise<StoredFile[]> {
  const { data, error } = await db.storage.from(BUCKET).list(userId, { sortBy: { column: "created_at", order: "desc" } });
  if (error) throw new Error(error.message);
  return data
    .filter((file) => file.name !== ".emptyFolderPlaceholder")
    .map((file) => ({
      name: file.name,
      path: `${userId}/${file.name}`,
      size: Number(file.metadata?.size ?? 0),
      type: String(file.metadata?.mimetype ?? TYPES[extname(file.name).toLowerCase()] ?? ""),
      updatedAt: file.updated_at ?? file.created_at ?? "",
    }));
}

// The cache control matters because Storage's default of an hour lets a CDN keep a copy that outlives its
// signed URL. upsert is off because the policies allow adding and deleting files but not changing them.
export async function uploadFile(db: Db, userId: string, name: string, bytes: Blob): Promise<string> {
  const path = `${userId}/${name}`;
  // The Blob's own type is what Storage checks, so a Blob made without one would be refused as octet-stream.
  const contentType = TYPES[extname(name).toLowerCase()];
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type: contentType }), {
    contentType,
    upsert: false,
    cacheControl: "0",
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function deleteFile(db: Db, path: string): Promise<void> {
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function downloadFile(db: Db, path: string): Promise<Blob> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed");
  return data;
}

// Storage signs "<bucket>/<path>" and an expiry into the token. The host isn't part of it.
export async function signFileUrl(db: Db, path: string, ttl: number): Promise<{ url: string; claims: Record<string, unknown> }> {
  // Storage looks the object up as this user first, so it refuses to sign a file their policies hide.
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, ttl);
  if (error || !data) throw new Error(error?.message ?? "Couldn't sign the URL");
  return { url: data.signedUrl, claims: tokenClaims(data.signedUrl) };
}

// The token is a JWT, and its payload is plain base64url JSON: {url, iat, exp}.
export function tokenClaims(url: string): Record<string, unknown> {
  const token = new URL(url).searchParams.get("token") ?? "";
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
  } catch {
    return {};
  }
}

export async function recordRead(db: Db, read: { object_name: string; mode: "signed_url" | "upload"; url_expires_at: string | null; question: string }): Promise<void> {
  const { error } = await db.from("file_reads").insert(read);
  if (error) throw new Error(error.message);
}

export async function listReads(db: Db): Promise<Read[]> {
  const { data, error } = await db
    .from("file_reads")
    .select("id, object_name, mode, url_expires_at, question, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data;
}
