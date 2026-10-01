import type { NextRequest } from "next/server";
import { RULE, createReferenceRow } from "@/lib/admin-reference-data";

/** POST /api/admin/reference-data/rules — create a recommendation rule. HR/admin only. */
export async function POST(req: NextRequest) {
  return createReferenceRow(RULE, req);
}
