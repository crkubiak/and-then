# PRD: TaskFlow (`todo.txt` Edition)

**Version:** 2.1
**Date:** 2026-10-30
**Status:** Revised after second review
**Platform:** Vanilla HTML/CSS/JS web app served by a zero-dependency local Node server that reads and writes real `todo.txt` and `done.txt` files.

---

## 1. Summary

TaskFlow is a personal task manager built on the `todo.txt` format: one line is one task, readable in any text editor. It adds task nesting, dependencies, collapsible `+Project` sections, and tree-safe archiving to `done.txt`.

Standard `todo.txt` conventions are used wherever they exist. Extensions use the spec's `key:value` mechanism. Full compatibility with other `todo.txt` tools is not a goal.

### 1.1 Primary editor: an AI agent

Most edits to `todo.txt` will be made by an AI agent writing to the file directly, not through the UI. This shapes the design:

- **The files are the source of truth.** The UI is a live view of the files that can also edit them.
- **The UI refreshes live** when the files change on disk (§7.1).
- **Rules are validated, not only enforced.** The UI prevents rule violations, but an agent writing to the file can bypass the UI. Every rule in §3 and §4 can therefore be checked by a validator, which is available as a CLI the agent runs after editing (§8) and as a Problems panel in the UI (§5.6).
- **The format is documented for the agent** in `docs/FORMAT.md`, a short reference covering syntax, ID allocation, and the rules.

### 1.2 In scope (v1)

- Parsing and serializing `todo.txt` / `done.txt` (standard format plus the extensions in §3)
- Validator, available as a CLI and as a UI Problems panel
- Live reload when files change on disk
- Adding tasks, inline editing, completing and reopening
- Nesting (`parent:`) and dependencies (`dep:`) with the rules in §4
- Project accordions, the Inbox section, and the Hide Completed toggle
- Sweeping to `done.txt` (§6)
- Raw text drawer for editing both files directly

### 1.3 Out of scope

See §10. Automated tests are deferred. The parsing and rules classes don't touch the page, so tests can be added later without restructuring.

---

## 2. Standard `todo.txt` Format

### 2.1 Active task

```text
(A) 2026-10-30 Call supplier about server racks +Infrastructure @phone id:10 parent:8 dep:5 due:2026-11-15
```

1. **Priority (optional):** `(A)` to `(Z)` at the start of the line.
2. **Creation date (required):** `YYYY-MM-DD` after the priority. The app adds it automatically to tasks created in the UI. An open task in `todo.txt` without one is a validation error (§8), and inline edit won't remove it. Completed lines and `done.txt` are exempt.
3. **Description:** Free text containing `+project`, `@context`, and `key:value` tokens in any order.

### 2.2 Completed task

```text
x 2026-10-30 2026-10-25 (A) Call supplier about server racks +Infrastructure @phone id:10
```

1. `x ` at index 0, followed by the completion date.
2. The creation date follows if the task had one. It is optional.
3. The priority is kept as `(A)` after the dates.
4. **Reopening** removes `x` and the completion date and moves `(A)` back to the start of the line.

### 2.3 Token rules

- A token is a whitespace-delimited word.
- `+project` and `@context` count only when the token starts with `+` or `@` and has at least one character after it.
- A `key:value` token needs a non-empty key and value with no spaces. Unknown keys are preserved and ignored.
- If a key appears more than once on a line, the first occurrence wins and the validator reports it.

---

## 3. Extensions

| Feature | Token | Behavior |
| :--- | :--- | :--- |
| Project | `+Project_Name` | Standard. Groups the task into a project accordion. Underscores display as spaces. |
| Context | `@context` | Standard. Shown as a badge. |
| Due date | `due:YYYY-MM-DD` | Common convention. Used for sorting and overdue badges. |
| Task ID | `id:ID` | Unique identifier, numeric (`id:12`) or semantic (`id:db-init`). |
| Parent | `parent:ID` | Nests the task under the task with that ID. Multiple levels are supported. |
| Dependency | `dep:ID` | The task is blocked until the task with that ID is complete. |
| Needs human | `needs:human` | An agent adds it when it is blocked on the user (a decision, credentials, a review), drops its `wip:` at the same time, and writes the question in the task text or a subtask. Rows hide it and show a red "Human" pill first in the tail on open tasks. Clicking the pill asks to clear it. The header shows "N need you", and clicking it jumps to each such task in turn, wrapping. Completing from the app strips it. Any other value is ignored and warned about. |
| In progress | `wip:Model_version` | An agent adds it when it starts on a task and removes it when it stops or finishes. Rows hide it and show a pulsing yellow "Opus 5.5 working" pill on open tasks. Completing from the app strips it. Inline edit may add, change or remove it. |
| Author | `by:me` or `by:Model_version` | Who created the task: `me` for the user, `Opus_5.5` style for an agent. No spaces, underscores display as spaces. Rows hide it and show a badge (muted "me", teal for agents). Lines without it show no badge, and a missing `by:` is not a validation problem. The add input and + Subtask stamp `by:me` unless the typed line has one. Inline edit can add `by:` but never change or remove one. |

### 3.1 Hierarchy vs. dependency

These are two separate relationships:

- **`parent:` builds the tree.** A task has **at most one parent**, and a parent can have any number of subtasks. A second `parent:` token on a line is a validation error, and the first one wins.
- **`dep:` expresses "can't finish until."** It points at any task, in any project, and does not affect where the task renders. v1 allows one `dep:` per task.

### 3.2 Subtasks share their root's project

- A subtask belongs to the primary project of its **root ancestor**, and renders in that project's section.
- A subtask line may omit `+project`, in which case it inherits the root's project. It may not name a **different** primary project.
- The UI makes a mismatch impossible:
  - **+ Subtask** writes the root's project onto the new line.
  - An inline edit that would change a subtask's primary project is rejected with a message.
  - Adding `parent:` to a task in another project is rejected the same way.
- A mismatch written directly to the file is a validation error. The subtask still renders under its parent, with an error badge.

### 3.3 IDs

- IDs must be unique across `todo.txt` **and** `done.txt`.
- New numeric IDs are one more than the highest numeric ID in either file. IDs are never reused, so archived references cannot point at a new task. `docs/FORMAT.md` tells the agent to follow the same rule.
- If an ID is duplicated, references resolve to the first occurrence in `todo.txt` and the validator reports every duplicate.

### 3.4 Reference resolution

| Case | Behavior |
| :--- | :--- |
| `parent:` or `dep:` points at an ID in `todo.txt` | Normal |
| `dep:` points at an ID found only in `done.txt` | Satisfied |
| `parent:` points at an ID found only in `done.txt` | Renders at the root. Validation error. |
| Points at an ID that doesn't exist | Renders at the root (for `parent:`) or ignores the dependency (for `dep:`). Validation error. |
| `parent:` cycle or self-reference | The cycle is broken at the first task found in file order, which renders at the root. Validation error. |
| `dep:` cycle | Validation error on every task in the cycle. The dependencies remain overridable (§4.2). |

### 3.5 Line preservation

The app never rewrites a line the user didn't act on. File order, unknown tokens, and spacing are preserved. Sorting in the UI affects the view only. This keeps an agent's diffs readable and avoids churn on lines it didn't touch.

---

## 4. Completion and Visibility Rules

### 4.1 Parents and subtasks

- **Completing a parent:** blocked in the UI while any descendant is incomplete. The checkbox shows a lock with the tooltip *"Complete N remaining subtasks first"*. Clicking it briefly highlights the incomplete descendants.
- **Reopening a subtask:** automatically reopens every completed ancestor.
- **Parent marked complete in the file while subtasks are open:** validation warning. The parent stays visible as an anchor (§4.3).

### 4.2 Dependencies

- An open task whose `dep:` target is incomplete shows a **"Blocked by #ID"** pill. Clicking the pill scrolls to the blocking task and highlights it.
- **Override:** checking a blocked task asks *"#12 is not complete. Complete anyway?"* If you confirm, the task is marked complete. Its `dep:12` token stays on the line, so the history of what it was waiting on is not lost. A completed task no longer shows the pill.

### 4.3 Hide Completed toggle

A toolbar checkbox, **Hide Completed**, persisted per browser.

- **Off:** All tasks are shown.
- **On:**
  - Completed tasks whose entire subtree is complete are hidden.
  - Completed tasks with any incomplete descendant stay visible with a warning badge.
  - Counters and progress bars still count hidden tasks.

---

## 5. UI

### 5.1 Project accordions

1. One accordion per unique primary project. The primary project is the first `+project` on a root task's line. Other projects appear as badges.
2. Root tasks with no project go into **Inbox**, pinned at the top.
3. Collapsed headers show: title, chevron, `active / total` count, the highest open priority badge, and a mini progress bar.
4. **Expand All** / **Collapse All** buttons in the toolbar.
5. Collapse state is saved per browser.

### 5.2 Sort order (view only)

Within each section, and within each sibling group, tasks sort by:

1. Open before completed
2. Priority, `(A)` first and no priority last
3. Due date, earliest first and none last
4. Creation date, oldest first
5. File order

### 5.3 Task row

- Checkbox (subject to §4), priority badge, description, and badges for context, secondary projects, due date or overdue status, Blocked-by, and validation problems. Open tasks also show an **age** in the tail, computed from the creation date at render time and never stored: `0D` to `29D` under 30 days, then whole calendar months (`1M` to `11M`), then whole years (`1Y`). A month-end start counts its anniversary on the last day of a shorter month. A creation date after today shows no age. Muted text, title "Created YYYY-MM-DD".
- Subtasks render indented under their parent with a tree guide line. The parent row has a collapse toggle.
- **+ Subtask:** opens a one-line input directly under the parent row, at the child indent inside the parent's rail, and expands the parent if it was collapsed. The user types only the description, plus an optional priority, context, due date or other tags. Nothing is written until Enter. On Enter, one save gives the parent a fresh `id:` if it has none, then appends the new line: the typed text, `+RootProject` (omitted for Inbox, or when the user typed that same project), `parent:<id>`, then the creation date and `by:me` from §5.4. A different typed project, or a typed `parent:`, is rejected with a message and the text stays. After a save the input stays open and empty under the same parent for the next subtask. Escape closes it, and so does leaving the field while it is empty; leaving it with text keeps it open. It follows the inline-edit rules: one editor at a time (opening another while this one has text focuses this one), the draft survives re-renders, and live reloads are held back until it closes.
- **New-task marker:** a todo.txt task the user has not seen yet shows a yellow dot before the description and bold text, with a visually hidden "New" for screen readers. "Seen" is kept in `localStorage` as task key (`id:<id>`, else exact line) to the line last seen. The first load ever records everything as seen, so nothing is new. A task is new when its key is not stored; `done.txt` tasks are ignored. Tasks added or changed by the app's own saves are marked seen at once. A task whose `id:` is stored but whose line differs from the stored one (an outside edit) is **edited** instead: a hollow teal ring, normal-weight text, a hidden "Edited" label, and a tooltip on the ring with a compact token diff such as `Edited: due 2026-11-05 → 2026-11-12`. An id-less task cannot be edited this way (its key is its line, so a change shows as new), and a task that is new stays just new. A marker clears, and the current line is stored, in either of two ways: the pointer moves over the row, or the row is clicked or focused. There is no timer, so a marker stays on screen, in a background tab, and across reloads until one of those happens. Rows reached together are saved as one batch. Only the innermost row under the pointer clears, so hovering a subtask leaves its parent's marker alone. A task under a collapsed parent or section is hidden, so it stays marked until it is expanded and seen. Expanding alone marks nothing. The marker fades out over about 300 ms (no fade under reduced motion). Nothing is re-rendered when a marker clears. The tooltip is also on the description button, after "Edit task.".
- **Collapsed rollup:** a collapsed parent row, and a collapsed project header, show one yellow pill beside the subtask counter (or the section counts) for the unseen tasks beneath it: `+2 new`, `1 edited`, or `+2 new · 1 edited`. It counts every descendant, so each collapsed ancestor level shows its own count. Expanded rows and sections show no pill, since the markers are visible. Expanding does not mark anything seen. A pill clears when the last marked task beneath it is cleared, so after expanding, the pointer has to reach each marked row. Tasks hidden by Hide Completed are not counted, because the user cannot see them to clear them. The pill shrinks, and disappears at zero, as markers clear, without a re-render. Stored keys that no longer exist are dropped. If storage is blocked, seen state lasts for the page session only.
- **Inline edit:** clicking the description opens the full raw line for editing. Enter saves and Escape cancels. Rejected edits: the project-mismatch cases in §3.2, an empty line or one with no words (deletion is not in v1), adding or removing the `x ` prefix (use the checkbox), removing the creation date from an open task, changing or removing an existing `id:` or duplicating another, and a `parent:` that is missing, in `done.txt`, or would form a cycle. The add input rejects the same `id:` and `parent:` cases and `x ` lines. The raw drawer (§5.5) rejects nothing.

### 5.4 Add task input

A single input at the top of the page that accepts a raw `todo.txt` line. The app adds today's creation date if the line has none.

### 5.5 Raw text drawer

A slide-over drawer with editable `todo.txt` and `done.txt` text areas. Saving re-parses and re-renders.

### 5.6 Problems panel

A toolbar badge shows the count of validation problems. Opening it lists each problem with its file, line number, and message. Clicking a problem scrolls to the task.

### 5.7 Visual design

Minimal layout, generous color. Dark theme only, built on the gruvbox-baby dark high-contrast palette. All colors are CSS custom properties on `:root` in `styles.css`. Components never use raw hex values.

| Token | Hex | Source |
| :--- | :--- | :--- |
| `--green` | `#8ec07c` | palette |
| `--teal` | `#458588` | palette |
| `--yellow` | `#eebd35` | palette |
| `--red` | `#cc241d` | palette |
| `--bg` | `#32302f` | palette |
| `--bg-deep` | `#282828` | gruvbox, page background |
| `--surface` | `#3c3836` | gruvbox, section and row hover |
| `--fg` | `#ebdbb2` | gruvbox, body text |
| `--fg-muted` | `#a89984` | gruvbox, secondary text |

**Contrast rule:** red and teal are too dark for small text on dark backgrounds. Use them only as fills, borders, and badge backgrounds with `--bg-deep` or `--fg` text on top. Green and yellow may be used as text.

**Color assignments:**

| Element | Color |
| :--- | :--- |
| Priority `(A)` | red badge |
| Priority `(B)` | yellow badge |
| Priority `(C)` | green badge |
| Priority `(D)` to `(Z)` | teal badge |
| Project sections | each project gets an accent from the rotation green, yellow, teal, red, assigned in order of first appearance; used for the header bar, the progress bar fill, and that project's badges elsewhere. Inbox uses `--fg-muted`. |
| `@context` | teal badge |
| Due date | overdue: red badge. Due within 3 days: yellow badge. Later: green badge. |
| Blocked-by pill | yellow outline |
| Validation error / warning badge | red / yellow |
| Completed task | `--fg-muted` text with strikethrough and a green check |
| Tree guide lines | by depth: the first nest level uses the project accent, then each deeper level steps through the rotation green, yellow, teal, red (Inbox starts at green) |
| Focus ring | yellow |

**Layout:** full-width and left-aligned with 32px page padding (16px at phone width), system font stack, no shadows or gradients. Spacing and color carry the structure instead of borders. The layout works at phone width with no horizontal scroll.

---

## 6. Sweeping to `done.txt`

A **Sweep (30d+)** button with a badge counting the tasks that qualify.

### 6.1 Eligibility

A completed task is swept **together with its entire subtree** when all of these are true:

1. Every task in the subtree is complete.
2. The **latest** completion date in the subtree is at least 30 calendar days before today's local date.
3. No incomplete task in `todo.txt` has a `dep:` on any task in the subtree.

Consequences:

- A completed subtask can be swept while its parent is still open, as long as the subtask's own subtree qualifies.
- A completed parent with any incomplete descendant is never swept.
- After a subtask is swept, the parent's counter covers only the subtasks still in `todo.txt`.

### 6.2 Execution

1. Append the qualifying lines to `done.txt`, unchanged and in their original file order.
2. Then remove them from `todo.txt`.
3. Show a toast: *"Swept N tasks to done.txt."*

The append happens before the removal so that a failure between the two steps duplicates lines rather than losing them.

---

## 7. Persistence and Live Sync

### 7.1 Local server

- `node server.js [dataDir]`. No dependencies. Binds to `127.0.0.1` only.
- Serves the static app files and the two data files in `dataDir` (default `./data`). Creates them if missing.
- Only the two fixed file paths are readable or writable.
- **API:**
  - `GET /api/files` returns `{ todo, done, version }`.
  - `PUT /api/files` accepts `{ todo, done, version }`.
  - `GET /api/events` is a Server-Sent Events stream that emits `changed` whenever either file changes on disk.
- **Writes are atomic:** write a temp file, then rename it.
- **Watching:** the server watches the data **directory** rather than the individual files, because editors and agents often save by replacing the file. Bursts of events are debounced, and the app's own writes are not echoed back as external changes.
- **`version`** is a hash of both files' contents.

### 7.2 Client

- **On `changed`:** reload both files and re-render. Expand/collapse state, scroll position, and any open inline edit are kept.
- **Saving:** every UI action (complete, reopen, edit, add, sweep) is saved immediately, with no debounce, which keeps the window for a clash with an agent's edit small.
- **Conflict:** if a save returns `409` because the agent changed the file first, the client reloads the files and re-applies the action to the fresh content, locating the line by `id:` or, without one, by exact text (the n-th identical line when several match). If the line no longer exists, the action is dropped and a toast says so. An inline edit or raw drawer save is not re-applied when its line or file changed underneath it, since that would overwrite the agent's change. It is refused with a toast and the draft is kept.
- **Open inline edit during an external change:** the edit stays open. On save, the conflict rule applies.
- `localStorage` holds only UI state: collapse state, Hide Completed, and which tasks were seen (§5.3).

---

## 8. Validator CLI

`node validate.js [dataDir]` checks both files and prints one problem per line:

```text
todo.txt:14  error    parent:99 does not match any task
todo.txt:22  error    subtask project +Ops differs from root project +Infra
todo.txt:31  warning  completed parent has 2 open subtasks
```

- It exits `0` when there are no errors and `1` when there are any. Warnings alone don't fail it.
- It uses the same validator class as the UI Problems panel.
- `docs/FORMAT.md` instructs the agent to run it after every edit.

**Checks:** duplicate keys, duplicate IDs, a second `parent:`, unresolved `parent:` / `dep:`, cycles, subtask project mismatch, completed parent with open descendants, malformed dates, an open task with no creation date, a completed task still carrying `wip:` (warning, either file), a completed task still carrying `needs:` or an unsupported `needs:` value (warnings), a line with no description (any line in either file).

---

## 9. Acceptance Examples

These are checked by hand for v1 and will become test cases when tests are added.

| Input | Expected |
| :--- | :--- |
| `(A) 2026-10-30 Call +Infra @phone id:10 due:2026-11-15` | priority A, created 2026-10-30, project Infra, context phone, id 10, due 2026-11-15 |
| `x 2026-10-30 2026-10-25 (A) Call +Infra` | complete, done 2026-10-30, created 2026-10-25, priority A |
| `x 2026-10-30 Call` | complete, no creation date, no priority |
| `Fix bug #482 in tracker` | no ID. `#482` is plain description text. |
| `Email a+b@example` | no project and no context, because neither token starts with `+` or `@` |
| `Task id:3 id:4` | id 3, duplicate-key error |
| `Task parent:3 parent:4` | parent 3, second-parent error |
| `Task parent:99` (no task 99) | renders at the root, unresolved-reference error |
| `(a) lowercase` | no priority. `(a)` is description text. |

---

## 10. Future

- Automated tests (`node:test`, no dependencies)
- **Deletion.** Decided behavior: deleting a parent shows a warning, and confirming promotes its subtasks to the root.
- Multiple `dep:` tokens per task
- Symbol shortcut aliases (`#`, `^`, `~`, `!`) behind a stricter pattern
- Search and filtering by context
- Recurring tasks
- Import/export and downloads
- Keyboard shortcuts

---

## 11. File tree

```text
server.js
validate.js
docs/       PRD.md, FORMAT.md, ACCEPTANCE.md, TASKS.md (pointer)
public/
  index.html
  styles.css
  js/
    main.js
    model/      Task.js, TaskParser.js, TaskSerializer.js, TaskList.js, IdAllocator.js
    rules/      Age.js, CompletionRules.js, EditRules.js, LineDiff.js, NewTaskRules.js, SortOrder.js, SweepRules.js, Validator.js, VisibilityRules.js
    io/         FileStore.js, LiveSync.js, SeenStore.js
    ui/         App.js, ProblemsPanel.js, ProjectPalette.js, ProjectSection.js, RawDrawer.js, TaskEditor.js, TaskInput.js, TaskRow.js, Toast.js, Toolbar.js
samples/    demo/, problems/ (fixtures with todo.txt and done.txt)
test/       live-sync.test.js (run with: node --test test/)
data/       the live data folder, todo.txt and done.txt (gitignored). Holds this project's own task tracking.
```
