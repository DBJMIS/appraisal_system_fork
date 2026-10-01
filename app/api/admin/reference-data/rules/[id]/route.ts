import type { NextRequest } from "next/server";
import { RULE, deleteReferenceRow, updateReferenceRow } from "@/lib/admin-reference-data";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/reference-data/rules/[id] — update a rule, or `{ active }` to activate/deactivate. HR/admin only. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return updateReferenceRow(RULE, req, id);
}

/** DELETE /api/admin/reference-data/rules/[id] — delete a recommendation rule. HR/admin only. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return deleteReferenceRow(RULE, id);
}
