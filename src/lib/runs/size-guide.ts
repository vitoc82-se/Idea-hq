// The size is how much work an AI coding agent has to do in this repo, not how long a person would need: it picks the
// model and the turn limit, and it is what the owner sees as turns, minutes and cost (lib/runs/sizes.ts).
export const SIZE_GUIDE = `Size scale. Measure the work an AI coding agent must do in this repo, not how long a human developer would need:
S (Quick) = one or two files, a small change, one test, no schema change. About 5 to 15 agent steps.
M (Standard) = a handful of files: a small new component or endpoint with its test, or a small additive schema field. About 15 to 35 steps.
L (Large) = a new feature across the app: a new model or endpoint with screens and tests, or logic that needs careful reading of existing code. About 30 to 60 steps.
XL (Epic) = more than one run can safely do: a new platform, a big rework, an external integration, a native app. It has to be split into steps first.
Go one size up when the change touches sign-in, payments, billing, the database schema or security rules, or when the project's build and tests cannot check it. Never answer in hours or days.`;
