type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Filter = (row: Row) => boolean;

/**
 * Minimal in-memory stand-in for the supabase-js query builder, covering the calls
 * used by the routes under test. Unique constraints are enforced on insert and update.
 */
export class FakeSupabase {
  tables: Record<string, Row[]>;
  /** Every insert/update/upsert/delete issued, in order. */
  writes: { table: string; op: "insert" | "update" | "upsert" | "delete"; payload: unknown }[] = [];
  /** Stand-ins for database functions called through supabase.rpc(). */
  rpcHandlers: Record<string, (args: Record<string, unknown>, db: FakeSupabase) => Result> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  private uniques: Record<string, string[][]>;
  private nextId = 1;

  constructor(tables: Record<string, Row[]>, uniques: Record<string, string[][]> = {}) {
    this.tables = tables;
    this.uniques = uniques;
  }

  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    return Promise.resolve(handler ? handler(args, this) : { data: null, error: { message: `function ${name} does not exist` } });
  }

  newId() {
    return `row-${this.nextId++}`;
  }

  violatesUnique(table: string, candidate: Row, ignore?: Row): string | null {
    for (const cols of this.uniques[table] ?? []) {
      const clash = this.tables[table].some(
        (r) => r !== ignore && cols.every((c) => r[c] === candidate[c])
      );
      if (clash) return `duplicate key value violates unique constraint (${cols.join(", ")})`;
    }
    return null;
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private columns: string[] | null = null;
  private orderings: { col: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom = 0;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private conflictCols: string[] = [];
  private inserted: Row[] = [];
  private countRows = false;
  private headOnly = false;
  /** `update(...).select()` returns the updated rows, as PostgREST does. */
  private returning = false;

  constructor(private db: FakeSupabase, private table: string) {}

  /** `{ count: "exact" }` adds the unpaged match count; `head: true` returns the count without rows. */
  select(cols = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.op === "update") {
      this.returning = true;
      if (cols.trim() !== "*") this.columns = cols.split(",").map((c) => c.trim());
      return this;
    }
    if (this.op === "select" && cols.trim() !== "*") this.columns = cols.split(",").map((c) => c.trim());
    if (opts?.count) this.countRows = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  /** SQL ILIKE: % and _ wildcards (backslash escapes them), case-insensitive. */
  ilike(col: string, pattern: string) {
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      else if (ch === "%") re += ".*";
      else if (ch === "_") re += ".";
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    const regex = new RegExp(`^${re}$`, "is");
    this.filters.push((r) => typeof r[col] === "string" && regex.test(r[col] as string));
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  /** Comparisons never match a missing or null column, as in SQL. */
  private compare(col: string, value: unknown, test: (x: never, y: never) => boolean) {
    this.filters.push((r) => r[col] != null && value != null && test(r[col] as never, value as never));
    return this;
  }
  gt(col: string, value: unknown) {
    return this.compare(col, value, (x, y) => x > y);
  }
  gte(col: string, value: unknown) {
    return this.compare(col, value, (x, y) => x >= y);
  }
  lt(col: string, value: unknown) {
    return this.compare(col, value, (x, y) => x < y);
  }
  lte(col: string, value: unknown) {
    return this.compare(col, value, (x, y) => x <= y);
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.limitN = to - from + 1;
    return this;
  }
  /** `is(col, null)` also matches rows that do not have the column at all. */
  is(col: string, value: null | boolean) {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderings.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflictCols = (opts?.onConflict ?? "id").split(",").map((c) => c.trim());
    return this;
  }

  private rows(): Row[] {
    let rows = this.db.tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    for (const { col, ascending } of [...this.orderings].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[col] as number, y = b[col] as number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(this.rangeFrom, this.rangeFrom + this.limitN);
    return rows;
  }

  private project(row: Row): Row {
    if (!this.columns) return { ...row };
    return Object.fromEntries(this.columns.map((c) => [c, row[c] ?? null]));
  }

  private execute(): Result {
    if (this.op !== "select") this.db.writes.push({ table: this.table, op: this.op, payload: this.payload });
    if (this.op === "delete") {
      const doomed = new Set(this.rows());
      this.db.tables[this.table] = this.db.tables[this.table].filter((r) => !doomed.has(r));
      return { data: null, error: null };
    }
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const p of list) {
        const row = { id: this.db.newId(), ...p };
        const clash = this.db.violatesUnique(this.table, row);
        if (clash) return { data: null, error: { message: clash } };
        this.db.tables[this.table].push(row);
        this.inserted.push(row);
      }
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const p of list) {
        const existing = this.db.tables[this.table].find((r) => this.conflictCols.every((c) => r[c] === p[c]));
        if (existing) {
          Object.assign(existing, p);
          continue;
        }
        const row = { id: this.db.newId(), ...p };
        const clash = this.db.violatesUnique(this.table, row);
        if (clash) return { data: null, error: { message: clash } };
        this.db.tables[this.table].push(row);
      }
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const matched = this.rows();
      for (const row of matched) {
        const next = { ...row, ...(this.payload as Row) };
        const clash = this.db.violatesUnique(this.table, next, row);
        if (clash) return { data: null, error: { message: clash } };
        Object.assign(row, this.payload);
      }
      return { data: this.returning ? matched.map((r) => this.project(r)) : null, error: null };
    }
    if (this.countRows) {
      const count = this.db.tables[this.table].filter((r) => this.filters.every((f) => f(r))).length;
      return { data: this.headOnly ? null : this.rows().map((r) => this.project(r)), error: null, count };
    }
    return { data: this.rows().map((r) => this.project(r)), error: null };
  }

  single(): Promise<Result> {
    if (this.op === "insert") {
      const result = this.execute();
      if (result.error) return Promise.resolve(result);
      if (this.inserted.length !== 1) return Promise.resolve({ data: null, error: { message: `expected 1 row, got ${this.inserted.length}` } });
      return Promise.resolve({ data: { ...this.inserted[0] }, error: null });
    }
    const rows = this.rows();
    if (rows.length !== 1) return Promise.resolve({ data: null, error: { message: `expected 1 row, got ${rows.length}` } });
    return Promise.resolve({ data: this.project(rows[0]), error: null });
  }

  maybeSingle(): Promise<Result> {
    const rows = this.rows();
    if (rows.length > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } });
    return Promise.resolve({ data: rows[0] ? this.project(rows[0]) : null, error: null });
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
