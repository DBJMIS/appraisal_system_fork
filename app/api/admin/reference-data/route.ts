import { getReferenceData } from "@/lib/admin-reference-data";

/** GET /api/admin/reference-data — categories, factors, rating scale and recommendation rules. HR/admin only. */
export async function GET() {
  return getReferenceData();
}
