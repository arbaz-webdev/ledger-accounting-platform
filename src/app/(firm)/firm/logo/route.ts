import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { requireFirmOwner } from "@/lib/auth";

export async function GET() {
  const user = await requireFirmOwner();
  const [firm] = await db.select({ data: firms.logoData, mime: firms.logoMime }).from(firms).where(eq(firms.id, user.firmId));
  if (!firm?.data || !firm.mime) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(firm.data), { headers: { "Content-Type": firm.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
