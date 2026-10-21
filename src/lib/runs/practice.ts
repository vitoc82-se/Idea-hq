// The tiny first idea offered while setting up a project: add one line to the README. It is as small as a change
// gets, so it is created already sized "S" (no AI estimate is spent on it) and always starts on the cheapest model.
export const PRACTICE_TITLE = "Practice: add a one-line note to the README";

export const isPracticeTitle = (title: unknown): boolean => typeof title === "string" && title.trim() === PRACTICE_TITLE;
