// Shared limits and vocabulary for the support (ticket) system.

export const TICKETS_FEATURE = "tickets";
export const KNOWN_FEATURES = [TICKETS_FEATURE] as const;

export const STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof STATUSES)[number];

// The same words everywhere (inbox, customer page, emails).
export const OWNER_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Waiting for customer",
  resolved: "Resolved",
  closed: "Closed",
};
export const CUSTOMER_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "We are looking at it",
  pending: "Waiting for your reply",
  resolved: "Resolved",
  closed: "Closed",
};

export const LIMITS = {
  messageMax: 5000,
  replyMax: 5000,
  questionMax: 1000,
  subjectMax: 120,
  nameMax: 80,
  emailMax: 254,
  titleMax: 60,
  replyTimeMax: 160,
  maxFormFields: 12,
  maxOrigins: 10,
  maxNotes: 40,
  noteTitleMax: 100,
  noteTextMax: 1500,
  notesTotalMax: 12000,
  answerMax: 1200,
  retentionMinDays: 7,
  retentionMaxDays: 3650,
  retentionDefaultDays: 365,
  aiCapMax: 500,
  aiCapDefault: 50,
};

export const DEFAULT_BRAND = "#047857";
export const DEFAULT_REPLY_TIME = "";

export const PUBLIC_KEY_RE = /^ihq_[A-Za-z0-9_-]{16}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
