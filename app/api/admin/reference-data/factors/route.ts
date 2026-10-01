import type { NextRequest } from "next/server";
import { FACTOR, createReferenceRow } from "@/lib/admin-reference-data";

/** POST /api/admin/reference-data/factors — create a competency factor. HR/admin only. */
export async function POST(req: NextRequest) {
  return createReferenceRow(FACTOR, req);
}
