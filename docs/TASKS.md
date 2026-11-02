# TaskFlow v1 Build Plan

Ordered so each phase can be run and checked before the next one starts. Section numbers refer to `docs/PRD.md`.

## Phase 1: Skeleton

- [x] 1.1 Create the folder layout from the file tree at the end of this document, plus a `.gitignore` covering `data/`
- [x] 1.2 `server.js`: serve `public/` as static files on `127.0.0.1`, with correct MIME types for `.js` modules
- [x] 1.3 `public/index.html` and an empty `styles.css`. `main.js` logs that it loaded.

**Check:** `node server.js` serves a blank page with no console errors.

## Phase 2: File API (§7.1)

- [x] 2.1 Create `data/todo.txt` and `data/done.txt` on startup if missing
- [x] 2.2 `GET /api/files` returning `{ todo, done, version }`, with `version` as a content hash
- [x] 2.3 `PUT /api/files` with an atomic temp-file-and-rename write, returning `409` on a stale version
- [x] 2.4 Restrict reads and writes to the two fixed paths

**Check:** `curl` can read and write the files, and a stale `PUT` gets `409`.

## Phase 3: Model (§2, §3)

- [x] 3.1 `Task`: the parsed fields plus the original raw line and line number
- [x] 3.2 `TaskParser`: priority, dates, completion, `+project`, `@context`, `key:value` tokens (§2.3)
- [x] 3.3 `TaskSerializer`: rewrites only the lines that changed. Handles complete and reopen, including moving `(A)` (§2.2).
- [x] 3.4 `TaskList`: ID index across both files, tree built from `parent:`, root-project inheritance (§3.2), reference resolution (§3.4)
- [x] 3.5 `IdAllocator`: the highest numeric ID across both files plus one (§3.3)

**Check:** the §9 acceptance examples parse as expected (a scratch script run with Node).

## Phase 4: Validator and agent docs (§8)

- [x] 4.1 `Validator`: every check listed in §8, returning `{ file, line, severity, message }`
- [x] 4.2 `validate.js` CLI with output format and exit codes as specified in §8
- [x] 4.3 `docs/FORMAT.md`: syntax, ID rule, subtask/project rule, sweep rule, and "run `node validate.js` after every edit"
- [x] 4.4 Sample data in `samples/demo` (clean) and `samples/problems` (one of each problem type), kept out of `data/` so real files are never overwritten

**Check:** the CLI reports every planted problem and nothing else. The agent can now start editing the files.

## Phase 5: Rules (§4, §6.1)

- [x] 5.1 `CompletionRules`: can a task be completed (descendants, dependency), plus reopening a task and its ancestors
- [x] 5.2 `VisibilityRules`: Hide Completed logic, with the anchor exception
- [x] 5.3 `SweepRules`: eligible subtrees under the three criteria

**Check:** scratch script against the sample data.

## Phase 6: Read-only UI (§5.1, §5.2, §5.3 display parts)

- [x] 6.1 `FileStore` (client): load files, save with version, handle `409`
- [x] 6.2 `App`: wires the store, model, and views together and re-renders on change
- [x] 6.3 `ProjectSection`: accordions, Inbox at top, header summary, collapse state in `localStorage`
- [x] 6.4 `TaskRow`: badges, indentation, tree guide lines, subtree collapse toggle
- [x] 6.5 View-only sort order (§5.2)
- [x] 6.6 `styles.css` base layout

**Check:** the sample data renders correctly, with no write actions yet.

## Phase 7: Live sync (§7.1, §7.2)

- [x] 7.1 Server: watch the data directory, debounce, and suppress echoes of the app's own writes
- [x] 7.2 Server: `GET /api/events` SSE stream
- [x] 7.3 Client: reload on `changed` while keeping collapse state, scroll position, and any open edit

**Check:** editing `todo.txt` in a text editor updates the page within about a second.

This phase comes before the write actions so that the conflict handling in Phase 8 can be built against real external changes.

## Phase 8: Write actions (§4, §5.3, §5.4, §7.2)

- [x] 8.1 Complete and reopen, with the parent lock, the descendant highlight, and ancestor reopen
- [x] 8.2 Blocked-by pill with scroll-to, and the dependency override confirmation
- [x] 8.3 `TaskInput`: add a task with an automatic creation date
- [x] 8.4 **+ Subtask**: pre-fill the root project and `parent:`, giving the parent an ID in the same save as the subtask
- [x] 8.5 Inline edit, with rejection of the project-mismatch cases (§3.2)
- [x] 8.6 Conflict retry: on `409`, reload, re-apply the action by `id:` or exact text, and toast if the line is gone
- [x] 8.7 `Toast`

**Check:** every action produces the expected one-line diff in `todo.txt`. An agent edit made mid-action does not lose either change.

## Phase 9: Toolbar and remaining panels

- [x] 9.1 `Toolbar`: Hide Completed, Expand/Collapse All
- [x] 9.2 Problems panel (§5.6) using `Validator`
- [x] 9.3 Sweep button with the eligible count, append-then-remove execution, and toast (§6)
- [x] 9.4 `RawDrawer`: edit both files, then save, re-parse, and re-render (§5.5)

**Check:** a sweep moves the right lines. Test this by backdating completion dates in the sample data.

## Phase 10: Acceptance pass

- [x] 10.1 Go through the §9 examples and each rule in §4 and §6 by hand in the UI
- [x] 10.2 Have the agent make a set of edits following `FORMAT.md`, then confirm the live reload, the validator, and the Problems panel agree

## Phase 11: Review feedback

Items raised while reviewing the running app. Picked up after the core run (Phases 8 to 10).

- [x] 11.1 New-task indicator. After each reload, diff task keys (`id:` first, exact line as fallback) against the known set kept in `localStorage`. The first load ever is a baseline, so nothing is new. Unknown keys get a yellow dot and bold text. Tasks added from the app are marked seen immediately.
- [ ] 11.2 Edited-task indicator. A task whose `id:` is known but whose line changed gets its own marker, distinct from new. Same storage, seen rules, and pill as 11.1.
- [ ] 11.3 Collapsed rollup. A collapsed row shows a yellow "+N new" pill next to its subtask counter, counting new and edited tasks anywhere beneath it, at every collapsed ancestor level. Collapsed project headers get the same pill.
- [ ] 11.4 Seen rules. A marker clears once the row has been on screen for about 1.5 seconds with the tab visible, or right away on click or focus. A task under a collapsed parent stays marked until it is expanded and seen.
- [x] 11.5 Duplicate id-less lines: two tasks with identical text share a key, so flash, focus restore, and edits hit the first match. Consider disambiguating by occurrence index.
- [x] 11.6 Toast: pause the timer on hover or focus, and keep error toasts up longer than info.
- [x] 11.7 Inline subtask input. + Subtask opens an input directly under the parent row at the child indent. The user types only the description; the root project and `parent:` (with the parent's new id when needed) are added on save and never shown. Enter saves, Escape cancels. The top input stays for tasks without a parent. Update PRD §5.3.
- [x] 11.8 Validator: warn on a line with no description (only tags), which the UI now refuses to create.
- [x] 11.9 Hide the Blocked by pill on completed tasks. After a dependency override the task keeps `dep:`, so the pill still shows (ACCEPTANCE A1).
- [x] 11.10 Author tag. New `by:` extension naming who created a task: `by:me` for the user, `by:<Model>_<version>` for an agent (e.g. `by:Opus_5.5`, `by:Flash_3.1`; underscores display as spaces, like projects). The add input and + Subtask append `by:me`. Rows hide the token and show a small badge: muted "me", teal for agents. Edits never change it, and lines without it show no badge. Add `by:` to PRD §3 and require it in FORMAT.md for every line an agent creates.
- [x] 11.11 Age badge. Computed from the creation date at render time, never stored in the file. Under 30 days shows days (`0D`, `12D`), under a year shows whole months (`1M`, `5M`), then whole years (`1Y`). Open tasks only. Muted, in the row tail; the title gives the creation date. The creation date becomes required on every open task: a `missing-creation-date` validator error, FORMAT.md says so, and inline edit rejects removing it (the add input already stamps it). Update `samples/` and `expected.txt` to match.
- [x] 11.12 In-progress tag. New `wip:` extension: an agent adds `wip:<Model>_<version>` (e.g. `wip:Opus_5.5`) to a line when it starts working on it and removes it when it stops or completes the task. Rows hide the token and show a yellow pulsing "Opus 5.5 working" pill (static under reduced motion). Completing a task from the app strips `wip:`. Validator warns on `wip:` on a completed task. Document the start/stop rule in FORMAT.md and add `wip:` to PRD §3.
- [x] 11.13 Needs-human tag. New `needs:human` extension: an agent adds it when it is blocked on the user (a decision, credentials, a review) and drops its `wip:` at the same time, with the question written in the task text or a subtask. Rows show a red "Human" pill; the header summary counts "N need you" and the pill gets the same scroll-to as Blocked by. Clicking the pill asks to clear it; completing the task strips it.
- [x] 11.14 FORMAT.md tag guide. One section covering `by:`, `wip:`, `needs:human`, and the creation-date rule: when to add each, when to remove each, and cleanup. Stale `wip:` is removed by hand (the user, or the next agent that finds one it didn't set and can confirm no agent is running). Validator rules for these tags must match the guide.

---

## File tree

```text
server.js
validate.js
docs/       PRD.md, TASKS.md, FORMAT.md
public/
  index.html
  styles.css
  js/
    main.js
    model/      Task.js, TaskParser.js, TaskSerializer.js, TaskList.js, IdAllocator.js
    rules/      CompletionRules.js, VisibilityRules.js, SweepRules.js, SortOrder.js, Validator.js, NewTaskRules.js, EditRules.js
    io/         FileStore.js, LiveSync.js
    ui/         App.js, Toolbar.js, ProjectSection.js, ProjectPalette.js, TaskRow.js, TaskInput.js, TaskEditor.js, RawDrawer.js, ProblemsPanel.js, Toast.js
data/       todo.txt, done.txt (gitignored)
```
