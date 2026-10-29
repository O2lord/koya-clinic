import { NextResponse } from "next/server";

// Lets the web page call the API without exposing the API key to the browser.
// Only /slots and /bookings are reachable here, never /reset.
const ALLOWED = new Set(["slots", "bookings"]);

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, { params }: Ctx) {
  const { path } = await params;
  if (!path?.length || !ALLOWED.has(path[0])) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const target = new URL(
    "/" + path.map(encodeURIComponent).join("/"),
    req.url,
  );
  target.search = new URL(req.url).search;

  const headers: Record<string, string> = {
    "x-api-key": process.env.API_KEY ?? "",
  };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const idem = req.headers.get("idempotency-key");
  if (idem) headers["idempotency-key"] = idem;

  const hasBody = req.method === "POST" || req.method === "PATCH";
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });

  const out = new Headers({ "content-type": "application/json" });
  const retry = res.headers.get("retry-after");
  if (retry) out.set("retry-after", retry);
  return new Response(await res.text(), { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
