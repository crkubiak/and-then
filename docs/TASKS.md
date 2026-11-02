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
- [ ] 6.5 View-only sort order (§5.2)
- [ ] 6.6 `styles.css` base layout

**Check:** the sample data renders correctly, with no write actions yet.

## Phase 7: Live sync (§7.1, §7.2)

- [ ] 7.1 Server: watch the data directory, debounce, and suppress echoes of the app's own writes
- [ ] 7.2 Server: `GET /api/events` SSE stream
- [ ] 7.3 Client: reload on `changed` while keeping collapse state, scroll position, and any open edit

**Check:** editing `todo.txt` in a text editor updates the page within about a second.

This phase comes before the write actions so that the conflict handling in Phase 8 can be built against real external changes.

## Phase 8: Write actions (§4, §5.3, §5.4, §7.2)

- [ ] 8.1 Complete and reopen, with the parent lock, the descendant highlight, and ancestor reopen
- [ ] 8.2 Blocked-by pill with scroll-to, and the dependency override confirmation
- [ ] 8.3 `TaskInput`: add a task with an automatic creation date
- [ ] 8.4 **+ Subtask**: ensure the parent has an ID, then pre-fill the root project and `parent:`
- [ ] 8.5 Inline edit, with rejection of the project-mismatch cases (§3.2)
- [ ] 8.6 Conflict retry: on `409`, reload, re-apply the action by `id:` or exact text, and toast if the line is gone
- [ ] 8.7 `Toast`

**Check:** every action produces the expected one-line diff in `todo.txt`. An agent edit made mid-action does not lose either change.

## Phase 9: Toolbar and remaining panels

- [ ] 9.1 `Toolbar`: Hide Completed, Expand/Collapse All
- [ ] 9.2 Problems panel (§5.6) using `Validator`
- [ ] 9.3 Sweep button with the eligible count, append-then-remove execution, and toast (§6)
- [ ] 9.4 `RawDrawer`: edit both files, then save, re-parse, and re-render (§5.5)

**Check:** a sweep moves the right lines. Test this by backdating completion dates in the sample data.

## Phase 10: Acceptance pass

- [ ] 10.1 Go through the §9 examples and each rule in §4 and §6 by hand in the UI
- [ ] 10.2 Have the agent make a set of edits following `FORMAT.md`, then confirm the live reload, the validator, and the Problems panel agree

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
    rules/      CompletionRules.js, VisibilityRules.js, SweepRules.js, Validator.js
    io/         FileStore.js
    ui/         App.js, Toolbar.js, ProjectSection.js, TaskRow.js, TaskInput.js, RawDrawer.js, ProblemsPanel.js, Toast.js
data/       todo.txt, done.txt (gitignored)
```
