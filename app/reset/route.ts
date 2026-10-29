import { NextResponse } from "next/server";
import { db, err, denied } from "@/lib/api";

export async function POST(req: Request) {
  const d = denied(req);
  if (d) return d;

  const body = await req.json().catch(() => null);
  const slots = body?.slots;
  if (!Array.isArray(slots)) return err(400, "slots must be an array");

  const ids = new Set<string>();
  for (const s of slots) {
    const ok =
      s &&
      typeof s.id === "string" &&
      s.id !== "" &&
      typeof s.provider === "string" &&
      typeof s.start === "string" &&
      typeof s.end === "string" &&
      !isNaN(Date.parse(s.start)) &&
      !isNaN(Date.parse(s.end)) &&
      !ids.has(s.id);
    if (!ok) return err(400, "invalid or duplicate slot");
    ids.add(s.id);
  }

  const { error } = await db.rpc("reset_data", { p_slots: slots });
  if (error) return err(500, "internal error");
  return NextResponse.json({ ok: true });
}
