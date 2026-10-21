// The GitHub Actions the installed workflow uses, pinned to an exact commit instead of a moving tag.
// A tag like @v4 can be re-pointed (it has happened to popular actions) and would then run someone
// else's code next to the AI key. To update: look up the new release's commit, change it here, bump
// WORKFLOW_VERSION in workflow.ts, and let projects take the update.
export const ACTION_PINS = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  setupNode: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
  uploadArtifact: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4",
  downloadArtifact: "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4",
  claudeCode: "anthropics/claude-code-action@a5a423f75c251dcbff8a74e99f83b2cb03c72bfa # v1",
} as const;
