import type { NextRequest } from "next/server";
import { CATEGORY, createReferenceRow } from "@/lib/admin-reference-data";

/** POST /api/admin/reference-data/categories — create a competency category. HR/admin only. */
export async function POST(req: NextRequest) {
  return createReferenceRow(CATEGORY, req);
}
