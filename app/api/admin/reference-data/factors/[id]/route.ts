import type { NextRequest } from "next/server";
import { FACTOR, deleteReferenceRow, updateReferenceRow } from "@/lib/admin-reference-data";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/reference-data/factors/[id] — update a factor, or `{ active }` to activate/deactivate. HR/admin only. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return updateReferenceRow(FACTOR, req, id);
}

/** DELETE /api/admin/reference-data/factors/[id] — delete a competency factor. HR/admin only. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return deleteReferenceRow(FACTOR, id);
}
