// A small in-memory stand-in for the Prisma client, enough for the run engine.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(actual);
    if ("not" in c) return actual !== c.not;
    if ("gt" in c) return typeof actual === "number" && actual > (c.gt as number);
    if ("gte" in c) return actual instanceof Date ? actual.getTime() >= (c.gte as Date).getTime() : (actual as number) >= (c.gte as number);
    if ("equals" in c) return String(actual).toLowerCase() === String(c.equals).toLowerCase();
  }
  return actual === cond;
}

export function makeFakeDb() {
  const tables: Record<string, Row[]> = {
    user: [], project: [], idea: [], run: [], webhookDelivery: [], githubInstallation: [], projectMemory: [],
  };
  let seq = 0;
  const rel: Record<string, string> = { project: "project", idea: "idea", user: "user" };

  const attach = (row: Row | null, include?: Record<string, boolean>) => {
    if (!row) return null;
    const out = { ...row };
    for (const k of Object.keys(include || {})) {
      const fk = rel[k] && `${k}Id`;
      out[k] = fk && row[fk] ? tables[k].find((r) => r.id === row[fk]) || null : null;
    }
    return out;
  };

  const matches = (table: string, row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k in rel && v && typeof v === "object" && !("in" in (v as object))) {
        const child = tables[k].find((r) => r.id === row[`${k}Id`]);
        return !!child && matches(k, child, v as Row);
      }
      return matchValue(row[k], v);
    });

  const model = (name: string) => ({
    findFirst: async (a: Row = {}) => {
      let rows = tables[name].filter((r) => matches(name, r, a.where));
      if (a.orderBy?.createdAt === "desc") rows = [...rows].reverse();
      return attach(rows[0] || null, a.include);
    },
    findUnique: async (a: Row) => attach(tables[name].find((r) => matches(name, r, a.where)) || null, a.include),
    findMany: async (a: Row = {}) => tables[name].filter((r) => matches(name, r, a.where)).map((r) => attach(r, a.include)),
    count: async (a: Row = {}) => tables[name].filter((r) => matches(name, r, a.where)).length,
    create: async (a: Row) => {
      if (name === "webhookDelivery" && tables[name].some((r) => r.id === a.data.id)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const now = new Date();
      const row = { id: a.data.id ?? `r${++seq}x`, createdAt: now, updatedAt: now, ...a.data };
      tables[name].push(row);
      return { ...row };
    },
    update: async (a: Row) => {
      const row = tables[name].find((r) => matches(name, r, a.where));
      if (!row) throw new Error("not found");
      apply(row, a.data);
      return { ...row };
    },
    updateMany: async (a: Row) => {
      const rows = tables[name].filter((r) => matches(name, r, a.where));
      for (const r of rows) apply(r, a.data);
      return { count: rows.length };
    },
    aggregate: async (a: Row) => {
      const rows = tables[name].filter((r) => matches(name, r, a.where));
      const sum: Row = {};
      for (const k of Object.keys(a._sum || {})) sum[k] = rows.length ? rows.reduce((n, r) => n + (r[k] ?? 0), 0) : null;
      return { _sum: sum };
    },
    deleteMany: async (a: Row) => {
      const keep = tables[name].filter((r) => !matches(name, r, a.where));
      const count = tables[name].length - keep.length;
      tables[name] = keep;
      return { count };
    },
    upsert: async (a: Row) => {
      const hit = tables[name].find((r) => r.userId === a.where.userId_id.userId && r.id === a.where.userId_id.id);
      if (hit) return hit;
      tables[name].push({ ...a.create });
      return a.create;
    },
  });

  const db: Record<string, unknown> = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    $queryRaw: async () => [],
  };
  for (const t of Object.keys(tables)) db[t] = model(t);
  return { db, tables };
}

function stripUndefined(o: Row) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// Plain values, plus Prisma's { increment } / { decrement } on numbers.
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(stripUndefined(data))) {
    if (v && typeof v === "object" && !(v instanceof Date) && ("increment" in v || "decrement" in v)) {
      const d = v as { increment?: number; decrement?: number };
      row[k] = (row[k] ?? 0) + (d.increment ?? 0) - (d.decrement ?? 0);
    } else row[k] = v;
  }
  row.updatedAt = new Date();
}
