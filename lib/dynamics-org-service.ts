import { createDataverseApiClient } from "@/lib/dynamics-sync";

/**
 * Employee hierarchy from Dynamics 365 HR (xrm1_employee entity in Dataverse).
 * Does not use reporting_lines; uses xrm1_employeeid and manager/division head lookups.
 *
 * Data source: xrm1_employee (entity set xrm1_employees).
 * Primary key: xrm1_employeeid.
 * Manager: _xrm1_manager_employee_id_value.
 * Division head: _xrm1_employee_department_head_id_value.
 * System user mapping: _xrm1_employee_user_id_value.
 *
 * Env: DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET, DYNAMICS_DATAVERSE_URL
 */

const XRM_EMPLOYEES_ENTITY = process.env.DYNAMICS_XRM_EMPLOYEE_ENTITY ?? "xrm1_employees";
const SELECT_FIELDS =
  "xrm1_employeeid,xrm1_employee_number,xrm1_first_name,xrm1_last_name,xrm1_fullname,emailaddress,xrm1_job_title,_dbjhr_divisions_value,_xrm1_employee_department_id_value,_xrm1_manager_employee_id_value,_xrm1_employee_department_head_id_value,_xrm1_employee_user_id_value";

/** Format GUID for OData v4 $filter (bare GUID, no guid'...' wrapper). Strips braces if present. */
function guidFilter(value: string): string {
  return String(value).replace(/^\{|\}$/g, "").trim();
}

export interface Xrm1Employee {
  xrm1_employeeid: string;
  xrm1_employee_number: string | null;
  xrm1_first_name: string | null;
  xrm1_last_name: string | null;
  xrm1_fullname: string | null;
  emailaddress: string | null;
  /** Often used in Dataverse for primary email (e.g. Delano.Walters@dbankjm.com). */
  internalemailaddress?: string | null;
  xrm1_job_title?: string | null;
  _dbjhr_divisions_value: string | null;
  _xrm1_employee_department_id_value?: string | null;
  _xrm1_manager_employee_id_value: string | null;
  _xrm1_employee_department_head_id_value: string | null;
  _xrm1_employee_user_id_value: string | null;
}

export interface HierarchyNode {
  employeeId: string;
  employeeNumber: string | null;
  fullName: string | null;
  email: string | null;
  divisionId: string | null;
  isManager: boolean;
  directReports: HierarchyNode[];
}

function toFullName(emp: Xrm1Employee): string | null {
  if (emp.xrm1_fullname) return emp.xrm1_fullname;
  const parts = [emp.xrm1_first_name, emp.xrm1_last_name].filter(Boolean);
  return parts.length ? parts.join(" ").trim() : null;
}

/** OData filter for employees eligible for appraisal: Active, employed (not resigned/retired), linked to a user. */
const ELIGIBLE_EMPLOYEE_FILTER = (options?: { includeTerminationCheck?: boolean }) => {
  const activeEmploymentType =
    process.env.DYNAMICS_EMPLOYEE_TYPE_ACTIVE ?? "693100000";
  const base =
    `statecode eq 0 and xrm1_employee_type eq ${activeEmploymentType} and _xrm1_employee_user_id_value ne null`;
  if (options?.includeTerminationCheck !== true) return base;
  const today = new Date().toISOString().split("T")[0];
  return `${base} and (xrm1_termination_effective_date eq null or xrm1_termination_effective_date gt ${today})`;
};

/** Fetch all xrm1_employees with pagination. */
export async function getAllEmployees(): Promise<Xrm1Employee[]> {
  const client = await createDataverseApiClient();
  const results: Xrm1Employee[] = [];
  let nextUrl: string | null = `/${XRM_EMPLOYEES_ENTITY}?$select=${encodeURIComponent(SELECT_FIELDS)}&$top=5000`;

  while (nextUrl) {
    const res = await client.get<{ value?: Xrm1Employee[]; "@odata.nextLink"?: string }>(
      nextUrl.startsWith("http") ? nextUrl : nextUrl
    );
    const data = res.data as { value?: Xrm1Employee[]; "@odata.nextLink"?: string } | undefined;
    const page = data?.value ?? [];
    results.push(...page);
    nextUrl = data?.["@odata.nextLink"] ?? null;
  }

  return results;
}

/**
 * Fetch xrm1_employees eligible for appraisal creation (when a cycle is opened).
 * Filter: statecode=0 (Active), xrm1_employee_type=693100000 (Active employment),
 * _xrm1_employee_user_id_value ne null (has portal user). Optionally exclude terminated (termination_effective_date null or > today).
 */
export async function getEligibleEmployeesForAppraisal(options?: {
  includeTerminationCheck?: boolean;
}): Promise<Xrm1Employee[]> {
  const client = await createDataverseApiClient();
  const filter = ELIGIBLE_EMPLOYEE_FILTER(options);
  const results: Xrm1Employee[] = [];
  let nextUrl: string | null =
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=5000`;

  while (nextUrl) {
    const res = await client.get<{ value?: Xrm1Employee[]; "@odata.nextLink"?: string }>(
      nextUrl.startsWith("http") ? nextUrl : nextUrl
    );
    const data = res.data as { value?: Xrm1Employee[]; "@odata.nextLink"?: string } | undefined;
    const page = data?.value ?? [];
    results.push(...page);
    nextUrl = data?.["@odata.nextLink"] ?? null;
  }

  return results;
}

/** Get manager of an employee by xrm1_employeeid. Returns null if no manager or not found. */
export async function getManager(employeeId: string): Promise<Xrm1Employee | null> {
  const client = await createDataverseApiClient();
  const filter = `xrm1_employeeid eq ${guidFilter(employeeId)}`;
  const res = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  const data = res.data as { value?: Xrm1Employee[] } | undefined;
  const emp = data?.value?.[0];
  if (!emp?._xrm1_manager_employee_id_value) return null;
  const managerId = emp._xrm1_manager_employee_id_value;
  const mFilter = `xrm1_employeeid eq ${guidFilter(managerId)}`;
  const mRes = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(mFilter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  const mData = mRes.data as { value?: Xrm1Employee[] } | undefined;
  return mData?.value?.[0] ?? null;
}

/** Get direct reports of an employee (employees who have this employee as manager). */
export async function getDirectReports(employeeId: string): Promise<Xrm1Employee[]> {
  const client = await createDataverseApiClient();
  const filter = `_xrm1_manager_employee_id_value eq ${guidFilter(employeeId)}`;
  const results: Xrm1Employee[] = [];
  let nextUrl: string | null = `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=5000`;

  while (nextUrl) {
    const res = await client.get<{ value?: Xrm1Employee[]; "@odata.nextLink"?: string }>(
      nextUrl.startsWith("http") ? nextUrl : nextUrl
    );
    const data = res.data as { value?: Xrm1Employee[]; "@odata.nextLink"?: string } | undefined;
    const page = data?.value ?? [];
    results.push(...page);
    nextUrl = data?.["@odata.nextLink"] ?? null;
  }

  return results;
}

/**
 * System user ids of the managers above an employee, nearest first, following the same
 * _xrm1_manager_employee_id_value link as getManager. Stops at maxDepth, at a missing
 * manager, or when a record repeats (circular reporting data).
 */
export async function getManagerChainSystemUserIds(
  employeeSystemUserId: string,
  maxDepth: number
): Promise<string[]> {
  if (!employeeSystemUserId?.trim() || maxDepth <= 0) return [];
  const client = await createDataverseApiClient();
  const fetchOne = async (filter: string): Promise<Xrm1Employee | null> => {
    const res = await client.get<{ value?: Xrm1Employee[] }>(
      `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
    );
    return (res.data as { value?: Xrm1Employee[] } | undefined)?.value?.[0] ?? null;
  };

  let current = await fetchOne(`_xrm1_employee_user_id_value eq ${guidFilter(employeeSystemUserId)}`);
  const seen = new Set<string>();
  if (current?.xrm1_employeeid) seen.add(guidFilter(current.xrm1_employeeid).toLowerCase());
  const chain: string[] = [];
  for (let depth = 0; current && depth < maxDepth; depth++) {
    const managerId: string | null = current._xrm1_manager_employee_id_value;
    if (!managerId) break;
    const key = guidFilter(managerId).toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    current = await fetchOne(`xrm1_employeeid eq ${guidFilter(managerId)}`);
    if (!current) break;
    if (current._xrm1_employee_user_id_value) chain.push(current._xrm1_employee_user_id_value);
  }
  return chain;
}

/** Direct reports for several managers in batched requests (same filter as getDirectReports). */
export async function getDirectReportsForManagers(managerEmployeeIds: string[]): Promise<Xrm1Employee[]> {
  const ids = [...new Set(managerEmployeeIds.map(guidFilter).filter(Boolean))];
  if (ids.length === 0) return [];
  const client = await createDataverseApiClient();
  const results: Xrm1Employee[] = [];
  const CHUNK = 20;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const filter = ids
      .slice(i, i + CHUNK)
      .map((id) => `_xrm1_manager_employee_id_value eq ${id}`)
      .join(" or ");
    let nextUrl: string | null = `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=5000`;
    while (nextUrl) {
      const res = await client.get<{ value?: Xrm1Employee[]; "@odata.nextLink"?: string }>(nextUrl);
      const data = res.data as { value?: Xrm1Employee[]; "@odata.nextLink"?: string } | undefined;
      results.push(...(data?.value ?? []));
      nextUrl = data?.["@odata.nextLink"] ?? null;
    }
  }
  return results;
}

const XRM_DEPARTMENTS_ENTITY = process.env.DYNAMICS_XRM_DEPARTMENT_ENTITY ?? "xrm1_departments";
const DEPARTMENT_SELECT = "xrm1_departmentid,_xrm1_department_manager_employee_id_value";

export interface Xrm1Department {
  xrm1_departmentid: string;
  _xrm1_department_manager_employee_id_value: string | null;
}

/** Fetch xrm1_departments by id (for HOD: department manager = Head of Department). */
export async function getDepartment(departmentId: string): Promise<Xrm1Department | null> {
  if (!departmentId?.trim()) return null;
  const client = await createDataverseApiClient();
  const id = guidFilter(departmentId);
  const { data } = await client.get<Xrm1Department>(
    `/${XRM_DEPARTMENTS_ENTITY}(${id})?$select=${encodeURIComponent(DEPARTMENT_SELECT)}`
  );
  return data ?? null;
}

/**
 * Resolve manager's system user id for an employee (by employee's system user id).
 * Used for approval/signoff: compare with current_user.employee_id.
 */
export async function getManagerSystemUserId(employeeSystemUserId: string): Promise<string | null> {
  const emp = await getEmployeeBySystemUserId(employeeSystemUserId);
  if (!emp?.xrm1_employeeid) return null;
  const manager = await getManager(emp.xrm1_employeeid);
  return manager?._xrm1_employee_user_id_value ?? null;
}

/**
 * Resolve HOD (Head of Department) system user id from HRMIS department table:
 * employee → _xrm1_employee_department_id_value → xrm1_departments → _xrm1_department_manager_employee_id_value → that employee's user id.
 */
export async function getDepartmentHeadSystemUserId(employeeSystemUserId: string): Promise<string | null> {
  const hod = await getDepartmentHeadFromDepartmentTable(employeeSystemUserId);
  return hod?._xrm1_employee_user_id_value ?? null;
}

/**
 * Resolve HOD (Head of Department) xrm1_employee record from HRMIS department table:
 * employee → _xrm1_employee_department_id_value → xrm1_departments → _xrm1_department_manager_employee_id_value → that employee record.
 * Use for display (e.g. Division card department head name).
 */
export async function getDepartmentHeadFromDepartmentTable(employeeSystemUserId: string): Promise<Xrm1Employee | null> {
  const emp = await getEmployeeBySystemUserId(employeeSystemUserId);
  const deptId = emp?._xrm1_employee_department_id_value;
  if (!deptId) return null;
  const dept = await getDepartment(deptId);
  const hodEmployeeId = dept?._xrm1_department_manager_employee_id_value;
  if (!hodEmployeeId) return null;
  const client = await createDataverseApiClient();
  const headFilter = `xrm1_employeeid eq ${guidFilter(hodEmployeeId)}`;
  const { data } = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(headFilter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  return data.value?.[0] ?? null;
}

/** Get the division/department head for a division (xrm1_employee record). */
export async function getDivisionHead(divisionId: string): Promise<Xrm1Employee | null> {
  const client = await createDataverseApiClient();
  const filter = `_dbjhr_divisions_value eq ${guidFilter(divisionId)}`;
  const { data } = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  const emp = data.value?.[0];
  if (!emp?._xrm1_employee_department_head_id_value) return null;
  const headId = emp._xrm1_employee_department_head_id_value;
  const headFilter = `xrm1_employeeid eq ${guidFilter(headId)}`;
  const { data: headData } = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(headFilter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  return headData.value?.[0] ?? null;
}

/** Resolve xrm1_employee by system user id (_xrm1_employee_user_id_value). */
export async function getEmployeeBySystemUserId(systemUserId: string): Promise<Xrm1Employee | null> {
  const client = await createDataverseApiClient();
  const filter = `_xrm1_employee_user_id_value eq ${guidFilter(systemUserId)}`;
  const { data } = await client.get<{ value?: Xrm1Employee[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
  );
  return data.value?.[0] ?? null;
}

/** Fields needed for peer-eligible list and salary grade. */
const PEER_SELECT =
  "xrm1_employeeid,_xrm1_employee_user_id_value,xrm1_fullname,xrm1_first_name,xrm1_last_name,emailaddress,xrm1_job_title,dbjhr_salarygrade,_xrm1_employee_department_id_value";

/** Get participant's salary grade from Dynamics (xrm1_employees.dbjhr_salarygrade). Returns null if not found or no grade. */
export async function getParticipantSalaryGradeFromDynamics(systemUserId: string): Promise<number | string | null> {
  const client = await createDataverseApiClient();
  const filter = `_xrm1_employee_user_id_value eq ${guidFilter(systemUserId)}`;
  const { data } = await client.get<{ value?: { dbjhr_salarygrade?: number | string | null }[] }>(
    `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=dbjhr_salarygrade&$top=1`
  );
  const row = data.value?.[0];
  if (row?.dbjhr_salarygrade != null) return row.dbjhr_salarygrade;
  return null;
}

export interface PeerEligibleEmployee {
  employee_id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  department_name?: string | null;
}

/** Get all active xrm1_employees with the same salary grade (from Dynamics). employee_id = _xrm1_employee_user_id_value. */
export async function getSameGradeEmployeesFromDynamics(grade: number | string): Promise<PeerEligibleEmployee[]> {
  const client = await createDataverseApiClient();
  const activeType = process.env.DYNAMICS_EMPLOYEE_TYPE_ACTIVE ?? "693100000";
  const gradeNum = typeof grade === "string" && /^\d+$/.test(grade) ? Number(grade) : grade;
  const filter =
    `statecode eq 0 and xrm1_employee_type eq ${activeType} and _xrm1_employee_user_id_value ne null and dbjhr_salarygrade eq ${gradeNum}`;
  const results: PeerEligibleEmployee[] = [];
  let nextUrl: string | null = `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(PEER_SELECT)}&$top=5000`;

  type PageRes = {
    value?: {
      _xrm1_employee_user_id_value?: string | null;
      xrm1_fullname?: string | null;
      xrm1_first_name?: string | null;
      xrm1_last_name?: string | null;
      emailaddress?: string | null;
      xrm1_job_title?: string | null;
      _xrm1_employee_department_id_value?: string | null;
      "_xrm1_employee_department_id_value@OData.Community.Display.V1.FormattedValue"?: string | null;
    }[];
    "@odata.nextLink"?: string;
  };
  while (nextUrl) {
    const res = await client.get<PageRes>(nextUrl);
    const data = res.data as PageRes | undefined;
    const page = data?.value ?? [];
    for (const e of page) {
      const empId = e._xrm1_employee_user_id_value;
      if (!empId) continue;
      const fullName =
        e.xrm1_fullname ??
        ([e.xrm1_first_name, e.xrm1_last_name].filter(Boolean).join(" ").trim() || null);
      results.push({
        employee_id: empId,
        full_name: fullName ?? null,
        email: e.emailaddress ?? null,
        job_title: e.xrm1_job_title ?? null,
        department_name: (e as Record<string, unknown>)["_xrm1_employee_department_id_value@OData.Community.Display.V1.FormattedValue"] as string | undefined ?? null,
      });
    }
    nextUrl = data?.["@odata.nextLink"] ?? null;
  }
  return results.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

/** Resolve xrm1_employee by email. Tries internalemailaddress then emailaddress; exact and case-insensitive. */
export async function getEmployeeByEmail(email: string): Promise<Xrm1Employee | null> {
  if (!email?.trim()) return null;
  const client = await createDataverseApiClient();
  const raw = email.trim();
  const escaped = raw.replace(/'/g, "''");
  const lower = raw.toLowerCase();
  const lowerEscaped = lower.replace(/'/g, "''");
  const filters = [
    `internalemailaddress eq '${escaped}'`,
    `emailaddress eq '${escaped}'`,
    `tolower(internalemailaddress) eq '${lowerEscaped}'`,
    `tolower(emailaddress) eq '${lowerEscaped}'`,
  ];
  for (const filter of filters) {
    try {
      const { data } = await client.get<{ value?: Xrm1Employee[] }>(
        `/${XRM_EMPLOYEES_ENTITY}?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(SELECT_FIELDS)}&$top=1`
      );
      const emp = data.value?.[0];
      if (emp) return emp;
    } catch (err) {
      // Property may not exist, or request failed; try next filter
      if (process.env.NODE_ENV === "development") {
        console.warn("[dynamics-org-service] getEmployeeByEmail filter failed:", filter, err);
      }
    }
  }
  return null;
}

/** Build nested hierarchy: Division Head → Managers → Employees. Returns tree of nodes. */
export async function getHierarchyTree(): Promise<HierarchyNode[]> {
  const all = await getAllEmployees();
  const managerIds = new Set<string>();
  for (const e of all) {
    if (e._xrm1_manager_employee_id_value) managerIds.add(e._xrm1_manager_employee_id_value);
  }

  function toNode(emp: Xrm1Employee): HierarchyNode {
    const id = emp.xrm1_employeeid;
    const directReportEmps = all.filter((e) => e._xrm1_manager_employee_id_value === id);
    return {
      employeeId: id,
      employeeNumber: emp.xrm1_employee_number ?? null,
      fullName: toFullName(emp),
      email: emp.emailaddress ?? emp.internalemailaddress ?? null,
      divisionId: emp._dbjhr_divisions_value ?? null,
      isManager: managerIds.has(id),
      directReports: directReportEmps.map(toNode),
    };
  }

  const roots = all.filter((e) => !e._xrm1_manager_employee_id_value);
  if (roots.length > 0) {
    return roots.map(toNode);
  }
  const byId = new Map<string, Xrm1Employee>();
  for (const e of all) {
    if (e.xrm1_employeeid) byId.set(e.xrm1_employeeid, e);
  }
  const topManagerIds = new Set(
    all.filter((e) => e._xrm1_manager_employee_id_value && !byId.has(e._xrm1_manager_employee_id_value)).map((e) => e._xrm1_manager_employee_id_value!)
  );
  return all.filter((e) => topManagerIds.has(e.xrm1_employeeid)).map(toNode);
}
