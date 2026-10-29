import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side only. Uses the service-role key, which must never reach the browser.
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export function err(
  status: number,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: message }, { status, headers });
}

// Returns an error response if the key is missing or wrong, otherwise null.
export function denied(req: Request) {
  const expected = process.env.API_KEY;
  const given = req.headers.get("x-api-key");
  if (!expected || given !== expected) {
    return err(401, "missing or invalid API key");
  }
  return null;
}

export type BookingRow = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
};

export function shapeBooking(r: BookingRow) {
  return {
    id: r.id,
    slot_id: r.slot_id,
    name: r.name,
    email: r.email,
    status: r.status,
    created_at: new Date(r.created_at).toISOString(),
  };
}
