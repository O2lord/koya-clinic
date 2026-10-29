import { NextResponse } from "next/server";
import { db, err, denied, shapeBooking, type BookingRow } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const d = denied(req);
  if (d) return d;

  const { id } = await params;
  const { data } = await db
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data
    ? NextResponse.json(shapeBooking(data as BookingRow))
    : err(404, "booking not found");
}

// Reschedule: move a confirmed booking to a different open slot.
export async function PATCH(req: Request, { params }: Ctx) {
  const d = denied(req);
  if (d) return d;

  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const slot_id =
    typeof body.slot_id === "string" ? body.slot_id.trim() : "";
  if (!slot_id) return err(400, "slot_id is required");

  const { data: current } = await db
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!current) return err(404, "booking not found");
  if (current.status !== "confirmed") return err(409, "booking is cancelled");
  if (current.slot_id === slot_id) {
    return err(400, "booking is already at that time");
  }

  const { data: slot } = await db
    .from("slots")
    .select("id,start_at")
    .eq("id", slot_id)
    .maybeSingle();
  if (!slot) return err(404, "slot not found");
  if (new Date(slot.start_at).getTime() <= Date.now()) {
    return err(400, "slot has already started");
  }

  // An appointment that has already begun can no longer be moved.
  const { data: old } = await db
    .from("slots")
    .select("start_at")
    .eq("id", current.slot_id)
    .maybeSingle();
  if (old && new Date(old.start_at).getTime() <= Date.now()) {
    return err(400, "appointment has already started");
  }

  // One atomic UPDATE. The unique index one_confirmed_per_slot makes the
  // database reject the move if someone else holds the new slot, and the
  // status filter stops a booking that was just cancelled from coming back.
  const { data, error } = await db
    .from("bookings")
    .update({ slot_id })
    .eq("id", id)
    .eq("status", "confirmed")
    .select()
    .maybeSingle();
  if (error) {
    return error.code === "23505"
      ? err(409, "slot already booked")
      : err(500, "internal error");
  }
  if (!data) return err(409, "booking is cancelled");
  return NextResponse.json(shapeBooking(data as BookingRow));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const d = denied(req);
  if (d) return d;

  const { id } = await params;

  // One atomic UPDATE: only a confirmed booking can be cancelled, and only one
  // concurrent request can win.
  const { data } = await db
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "confirmed")
    .select()
    .maybeSingle();
  if (data) return NextResponse.json(shapeBooking(data as BookingRow));

  const { data: existing } = await db
    .from("bookings")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return existing
    ? err(409, "booking already cancelled")
    : err(404, "booking not found");
}
