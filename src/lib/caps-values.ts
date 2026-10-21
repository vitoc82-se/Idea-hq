// Plain numbers only (no imports), so the edge middleware can use them. Everything else is in caps.ts.
// How much one person (or one request) may store. Everything the owner types ends up in the database, and much of
// it is later sent to the AI, which costs money per character. Without limits one account (or one buggy page)
// could fill the database or run up a large AI bill with a single request.
export const CAPS = {
  title: 200,
  notes: 20_000,
  closureNote: 4_000,
  repro: 4_000,
  storyNotes: 4_000,
  storyScope: 2_000,
  storiesPerBreakdown: 40,
  tagsPerIdea: 8,
  blockedBy: 50,
  projectName: 80,
  projectContext: 30_000,
  colorChars: 20,
  urlChars: 500,
  instruction: 4_000,
  memoryText: 600,
  pinnedFacts: 100,
  memoryPerProject: 300,
  projectsPerUser: 50,
  ideasPerProject: 2_000,
  // A whole request (JSON text). Sign-up, tickets and the like are far smaller; pasted backlog lists use `bodyBytesLarge`.
  bodyBytes: 1_000_000,
  bodyBytesLarge: 2_000_000,
} as const;
