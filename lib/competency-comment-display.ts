export type CommentDisplay = "edit" | "read" | "hidden";

/**
 * Display-only rule for competency comments (employee or manager side). Editing permissions still come from the
 * caller; this only decides whether the comment UI is rendered:
 * - DRAFT: comments are not part of the stage, so no comment UI is shown.
 * - Otherwise an editable side shows its editor, and a read-only side shows its comment only when one exists.
 */
export function competencyCommentDisplay(
  status: string | null | undefined,
  editable: boolean,
  value: string | null | undefined
): CommentDisplay {
  if ((status ?? "").toUpperCase() === "DRAFT") return "hidden";
  if (editable) return "edit";
  return value != null && value.trim() !== "" ? "read" : "hidden";
}
