import { NextResponse } from "next/server";
import { db, err, denied } from "@/lib/api";

export async function GET(req: Request) {
  const d = denied(req);
  if (d) return d;

  const provider = new URL(req.url).searchParams.get("provider");
  const { data, error } = await db.rpc("list_slots", { p_provider: provider });
  if (error) return err(500, "internal error");
  return NextResponse.json({ slots: data });
}
