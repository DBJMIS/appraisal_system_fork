import { getManagerChainSystemUserIds } from "@/lib/dynamics-org-service";

/**
 * Read-only oversight for managers higher in the reporting line.
 * Grants viewing only; every mutation route keeps its own direct-role checks and never calls this.
 */

/** Levels above the employee that may view: 1 = direct manager, 2 = manager's manager, and so on. */
export const OVERSIGHT_MAX_DEPTH = 4;

const CHAIN_TTL_MS = 60_000;
const CHAIN_CACHE_MAX = 500;
const chainCache = new Map<string, { at: number; chain: string[] }>();

export function oversightKey(value: string | null | undefined): string {
  return String(value ?? "").replace(/^\{|\}$/g, "").trim().toLowerCase();
}

async function managerChain(employeeSystemUserId: string): Promise<string[]> {
  const key = oversightKey(employeeSystemUserId);
  const hit = chainCache.get(key);
  if (hit && Date.now() - hit.at < CHAIN_TTL_MS) return hit.chain;
  const chain = (await getManagerChainSystemUserIds(employeeSystemUserId, OVERSIGHT_MAX_DEPTH)).map(oversightKey);
  if (chainCache.size >= CHAIN_CACHE_MAX) chainCache.clear();
  chainCache.set(key, { at: Date.now(), chain });
  return chain;
}

/**
 * True when the viewer is above the appraisal's employee in the Dynamics reporting line,
 * within OVERSIGHT_MAX_DEPTH levels. Fails closed when the hierarchy cannot be read.
 */
export async function canViewAppraisalForOversight(
  viewerEmployeeId: string | null | undefined,
  appraisalEmployeeId: string | null | undefined
): Promise<boolean> {
  const viewer = oversightKey(viewerEmployeeId);
  const employee = oversightKey(appraisalEmployeeId);
  if (!viewer || !employee || viewer === employee) return false;
  try {
    return (await managerChain(employee)).includes(viewer);
  } catch (err) {
    console.warn("[appraisal-oversight] hierarchy lookup failed:", err instanceof Error ? err.name : "error");
    return false;
  }
}

/** Route helper: read access through the reporting line for a signed-in user with an employee id. */
export async function hasOversightReadAccess(
  user: { employee_id?: string | null } | null | undefined,
  appraisal: { employee_id?: string | null } | null | undefined
): Promise<boolean> {
  return canViewAppraisalForOversight(user?.employee_id ?? null, appraisal?.employee_id ?? null);
}

export function clearOversightCache(): void {
  chainCache.clear();
}
