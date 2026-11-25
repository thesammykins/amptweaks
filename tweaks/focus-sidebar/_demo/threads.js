// Made-up threads for the demo page. Times are minutes ago, so the page always looks current.
// state: working | idle | error | approve | asking | done (unread result) | stalled
// offline: its runner dropped off · unsent: your messages haven't reached it
// Nested kids: Amp's DOM flattens them under the root (as the real sidebar does); Amp's API keeps the real parent.
// apiParent: a thread Amp's DOM shows at the top level although Amp's API says it came from another thread.
export const SPACES = [
  {
    id: "S-mobile", title: "Mobile app", color: "#c9a227", ago: 40,
    kids: [
      { id: "T-push", title: "Fix push notification deep links", state: "asking", status: "Should this target iOS 18 or keep iOS 17 support?", repo: "mobile", model: "claude-opus-5-5", effort: "high", ago: 50 },
      { id: "T-haptics", title: "Add haptics to the composer", state: "working", status: "Running the simulator build", repo: "mobile", branch: "composer-haptics", model: "claude-sonnet-5-5", ago: 6 },
      { id: "T-icons", title: "Refresh app icons", state: "idle", status: "Exported 14 icon sizes", ago: 300 },
      { id: "T-a11y", title: "VoiceOver labels on settings", state: "idle", status: "Labelled 22 controls", ago: 900 },
      { id: "T-crash", title: "Triage crash reports", state: "idle", status: "Fixed the top 3 crashes", ago: 1500 },
    ],
  },
  {
    id: "S-site", title: "Website refresh", color: "#5fa8d3", ago: 180,
    kids: [
      { id: "T-pricing", title: "Rewrite the pricing page", state: "approve", status: "Run npm run deploy:preview?", repo: "web", model: "claude-opus-5-5", effort: "high", ago: 25 },
      { id: "T-og", title: "Social preview images", state: "idle", status: "Added images for 9 pages", ago: 2000 },
    ],
  },
];

export const THREADS = [
  { id: "T-launch", title: "Plan the 2.0 launch", state: "idle", pinned: true, status: "Drafted the launch checklist", repo: "docs", ago: 200 },
  {
    id: "T-billing", title: "Migrate billing to the v2 API", state: "working", status: "Editing src/billing/invoice.ts", repo: "api", branch: "billing-v2", model: "claude-opus-5-5", effort: "high", ago: 3, active: true,
    kids: [
      { id: "T-webhooks", title: "Update webhook handlers", state: "working", status: "Running the webhook tests", repo: "api", branch: "billing-v2", model: "claude-sonnet-5-5", ago: 2,
        kids: [{ id: "T-retries", title: "Retry failed webhook deliveries", state: "asking", status: "Cap retries at 5 or 10?", repo: "api", branch: "billing-v2", model: "claude-sonnet-5-5", ago: 4 }] },
      { id: "T-backfill", title: "Backfill invoice IDs", state: "error", error: "Rate limited by the payments provider. Try again later.", repo: "api", branch: "billing-v2", model: "claude-sonnet-5-5", ago: 14 },
      { id: "T-notes", title: "Write migration notes", state: "idle", status: "Wrote MIGRATION.md", ago: 30 },
      { id: "T-types", title: "Generate API types", state: "idle", status: "Generated 48 types", ago: 45 },
    ],
  },
  { id: "T-ci", title: "Speed up the CI cache", state: "working", status: "Comparing cache keys across runs", repo: "infra", model: "gpt-6.1-sol", effort: "medium", ago: 12 },
  { id: "T-ci-bench", title: "Benchmark the new cache keys", state: "working", status: "Timing 20 cold runs", repo: "infra", model: "claude-sonnet-5-5", ago: 9, apiParent: "T-ci", offline: true },
  { id: "T-flags", title: "Clean up feature flags", state: "idle", status: "Removed 12 stale flags", repo: "web", model: "claude-sonnet-5-5", ago: 70, unsent: true },
  { id: "T-leak", title: "Investigate memory leak in worker", state: "asking", status: "Is it OK to restart the staging queue?", repo: "api", model: "claude-opus-5-5", effort: "high", ago: 95 },
  { id: "T-csv", title: "Add CSV export to reports", state: "error", error: "You've reached your usage limit.", repo: "web", model: "claude-sonnet-5-5", ago: 140 },
  { id: "T-pg", title: "Upgrade to Postgres 17", state: "approve", status: "Run pg_upgrade --check on staging?", repo: "infra", model: "claude-opus-5-5", effort: "high", ago: 60 },
  { id: "T-sync", title: "Handle offline sync conflicts", state: "stalled", status: "Reading the merge strategy docs", repo: "mobile", model: "claude-sonnet-5-5", ago: 38 },
  { id: "T-logs", title: "Tidy up logging", state: "done", status: "Removed 41 noisy log lines", repo: "api", model: "claude-haiku-5-5", ago: 220 },
  { id: "T-readme", title: "Rewrite the README", state: "idle", status: "Opened a pull request", repo: "docs", ago: 400 },
  { id: "T-bundle", title: "Trim bundle size", state: "idle", status: "Saved 180 KB", repo: "web", ago: 700 },
  { id: "T-sso", title: "Add SSO for teams", state: "idle", status: "Merged", repo: "api", ago: 1300 },
  { id: "T-ipad", title: "Fix scroll jank on iPad", state: "idle", status: "Fixed in 1.4.2", repo: "mobile", ago: 1800 },
  { id: "T-empty", title: "Polish empty states", state: "idle", status: "Updated 6 screens", repo: "web", ago: 2600 },
  { id: "T-cold", title: "Profile cold start", state: "idle", status: "Cut launch time by 22%", repo: "mobile", ago: 3500 },
  { id: "T-cron", title: "Move cron jobs to queues", state: "idle", status: "Migrated 7 jobs", repo: "infra", ago: 4300 },
];
