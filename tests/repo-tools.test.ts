import { describe, it, expect } from "vitest";
import { createToolExecutor, runWithRepoTools, REPO_TOOLS } from "@/lib/repo-tools";

const FILES: Record<string, string> = {
  "pages/index.js": "export default function Home(){}",
  "pages/api/report.js": "export default function handler(){}",
  "lib/scoring.js": "export const score = 1",
  "prisma/schema.prisma": "model User { id Int }",
  ".env": "SECRET=1",
  "config/server.pem": "-----BEGIN-----",
  "big.js": "x".repeat(25000),
};
const gh = {
  listTree: async () => ({ paths: Object.keys(FILES), truncated: false }),
  getFile: async (_i: number, _o: string, _r: string, p: string) => (FILES[p] ? { sha: "s", content: FILES[p] } : null),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ref = { i: 1, owner: "o", repo: "r", ref: "main" };

describe("tool executor", () => {
  it("lists a folder one level deep and the top level", async () => {
    const ex = createToolExecutor(gh, ref);
    expect(await ex.run("list_dir", { path: "pages" })).toBe("api/\nindex.js");
    const top = await ex.run("list_dir", { path: "" });
    expect(top).toContain("pages/");
    expect(top).not.toContain(".env");
    expect(top).not.toContain("server.pem");
  });
  it("finds files by part of the name, never secrets", async () => {
    const ex = createToolExecutor(gh, ref);
    expect(await ex.run("find_files", { query: "SCOR" })).toBe("lib/scoring.js");
    expect(await ex.run("find_files", { query: "env" })).toBe("No files match.");
    expect(await ex.run("find_files", { query: "" })).toMatch(/Give some text/);
  });
  it("reads files, truncates big ones, and refuses secrets and traversal", async () => {
    const ex = createToolExecutor(gh, ref);
    expect(await ex.run("read_file", { path: "pages/index.js" })).toContain("Home");
    expect((await ex.run("read_file", { path: "big.js" })).length).toBeLessThan(10100);
    expect(await ex.run("read_file", { path: ".env" })).toMatch(/cannot be read/);
    expect(await ex.run("read_file", { path: "config/server.pem" })).toMatch(/cannot be read/);
    expect(await ex.run("read_file", { path: "../../etc/passwd" })).toMatch(/not found|cannot be read/i);
    expect(await ex.run("read_file", { path: "nope.js" })).toMatch(/not found/i);
    expect(ex.stats().filesRead).toEqual(["pages/index.js", "big.js"]);
  });
  it("stops reading after the total budget", async () => {
    const ex = createToolExecutor({ ...gh, getFile: async () => ({ sha: "s", content: "y".repeat(9000) }), listTree: async () => ({ paths: Array.from({ length: 20 }, (_, i) => `f${i}.js`), truncated: false }) } as any, ref); // eslint-disable-line @typescript-eslint/no-explicit-any
    let last = "";
    for (let i = 0; i < 12; i++) last = await ex.run("read_file", { path: `f${i}.js` });
    expect(last).toMatch(/budget used up/);
  });
  it("handles an unknown tool and a failing GitHub", async () => {
    const ex = createToolExecutor({ listTree: async () => { throw new Error("x"); }, getFile: async () => { throw new Error("x"); } } as any, ref); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await ex.run("delete_everything", {})).toMatch(/Unknown tool/);
    expect(await ex.run("list_dir", { path: "" })).toMatch(/empty|No such/);
    expect(await ex.run("read_file", { path: "a.js" })).toMatch(/not found/i);
  });
  it("only offers read-only tools", () => {
    expect(REPO_TOOLS.map((t) => t.name).sort()).toEqual(["find_files", "list_dir", "read_file"]);
  });
});

function fakeAnthropic(script: any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0;
  return { calls, messages: { create: async (args: any) => { calls.push(JSON.parse(JSON.stringify(args))); return script[Math.min(n++, script.length - 1)]; } } } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const toolUse = (id: string, name: string, input: object) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const answer = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

describe("tool loop", () => {
  it("lets the model look at files, then returns its answer", async () => {
    const ai = fakeAnthropic([toolUse("t1", "read_file", { path: "pages/index.js" }), answer("# Plan\nUse pages/index.js")]);
    const ex = createToolExecutor(gh, ref);
    const r = await runWithRepoTools({ anthropic: ai, model: "m", prompt: "write a plan", executor: ex });
    expect(r.text).toContain("# Plan");
    expect(r.toolCalls).toBe(1);
    expect(r.filesRead).toEqual(["pages/index.js"]);
    // the file contents were sent back as a tool result
    const second = ai.calls[1].messages;
    expect(second[second.length - 1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(second[second.length - 1].content[0].content).toContain("Home");
  });
  it("answers straight away when it needs no tools", async () => {
    const ai = fakeAnthropic([answer("done")]);
    const r = await runWithRepoTools({ anthropic: ai, model: "m", prompt: "p", executor: createToolExecutor(gh, ref) });
    expect(r).toMatchObject({ text: "done", toolCalls: 0 });
    expect(ai.calls).toHaveLength(1);
  });
  it("forces an answer once the tool budget is used (tool_choice none)", async () => {
    const ai = fakeAnthropic([toolUse("a", "list_dir", { path: "" }), toolUse("b", "list_dir", { path: "" }), answer("final")]);
    const r = await runWithRepoTools({ anthropic: ai, model: "m", prompt: "p", executor: createToolExecutor(gh, ref), maxToolCalls: 2 });
    expect(r.text).toBe("final");
    expect(ai.calls[2].tool_choice).toEqual({ type: "none" });
    expect(ai.calls[0].tool_choice).toBeUndefined();
  });
  it("never loops forever, even if the model keeps asking for tools", async () => {
    const ai = fakeAnthropic([toolUse("x", "list_dir", { path: "" })]);
    const r = await runWithRepoTools({ anthropic: ai, model: "m", prompt: "p", executor: createToolExecutor(gh, ref), maxToolCalls: 3 });
    expect(ai.calls.length).toBeLessThanOrEqual(5);
    expect(typeof r.text).toBe("string");
  });
});
