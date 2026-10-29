import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db, err, denied, shapeBooking, type BookingRow } from "@/lib/api";

export async function POST(req: Request) {
  const d = denied(req);
  if (d) return d;

  const raw = await req.json().catch(() => null);
  const b: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const slot_id = str(b.slot_id);
  const name = str(b.name);
  const email = str(b.email);

  const key = req.headers.get("idempotency-key")?.trim() || null;
  const hash = createHash("sha256")
    .update(JSON.stringify({ slot_id, name, email }))
    .digest("hex");

  const { data, error } = await db.rpc("create_booking", {
    p_key: key,
    p_hash: hash,
    p_slot_id: slot_id,
    p_name: name,
    p_email: email,
  });
  if (error || !data) return err(500, "internal error");

  return NextResponse.json(data.body, {
    status: data.status,
    headers: data.retry_after
      ? { "Retry-After": String(data.retry_after) }
      : undefined,
  });
}

export async function GET(req: Request) {
  const d = denied(req);
  if (d) return d;

  const p = new URL(req.url).searchParams;
  const email = p.get("email")?.trim().toLowerCase();
  if (!email) return err(400, "email is required");

  let limit = 10;
  if (p.has("limit")) {
    const l = p.get("limit")!;
    if (!/^\d+$/.test(l) || Number(l) < 1 || Number(l) > 50) {
      return err(400, "limit must be an integer between 1 and 50");
    }
    limit = Number(l);
  }

  let after = 0;
  const cursor = p.get("cursor");
  if (cursor) {
    const n = Number(Buffer.from(cursor, "base64url").toString());
    if (!Number.isInteger(n) || n < 0) return err(400, "invalid cursor");
    after = n;
  }

  const { data, error } = await db
    .from("bookings")
    .select("seq,id,slot_id,name,email,status,created_at")
    .eq("email", email)
    .gt("seq", after)
    .order("seq", { ascending: true })
    .limit(limit + 1);
  if (error || !data) return err(500, "internal error");

  const page = data.slice(0, limit);
  const next_cursor =
    data.length > limit
      ? Buffer.from(String(page[page.length - 1].seq)).toString("base64url")
      : null;

  return NextResponse.json({
    bookings: page.map((r) => shapeBooking(r as BookingRow)),
    next_cursor,
  });
}
