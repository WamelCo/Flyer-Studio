import { databaseConfigured, query, sql } from "@flyer/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness for the container healthcheck: the server answers and the database does too. */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ ok: false, database: "not configured" }, { status: 503 });
  try {
    await query(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
