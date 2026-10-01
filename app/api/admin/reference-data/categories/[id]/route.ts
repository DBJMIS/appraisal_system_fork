import type { NextRequest } from "next/server";
import { CATEGORY, deleteReferenceRow, updateReferenceRow } from "@/lib/admin-reference-data";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/reference-data/categories/[id] — update a competency category. HR/admin only. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return updateReferenceRow(CATEGORY, req, id);
}

/** DELETE /api/admin/reference-data/categories/[id] — delete a competency category. HR/admin only. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return deleteReferenceRow(CATEGORY, id);
}
