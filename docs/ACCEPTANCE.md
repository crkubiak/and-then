# Acceptance pass (Task 10.1)

Date: 2026-11-02. Scope: PRD §9 examples and the rules in §3, §4, §6, §7.2, plus the §8 validator and the checkable parts of §5.

Method: scripts against the real code. Rules classes directly, `App` with a fake DOM, and a real `server.js` with real PUTs against scratch copies of the samples (ports 3300 to 3399). External agent edits were simulated by writing the scratch files directly. `node validate.js samples/demo` is clean (exit 0). `node validate.js samples/problems` matches `expected.txt` exactly (12 errors, 3 warnings, exit 1). Scripts live in the session scratchpad, not the repo.

"Not verifiable" means it needs a real browser. See the checklist at the end.

## 1. Results

### §9 Acceptance examples

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §9.1 `(A) 2026-10-30 Call +Infra @phone id:10 due:2026-11-15` | Pass | TaskParser fields |
| §9.2 `x 2026-10-30 2026-10-25 (A) Call +Infra` | Pass | TaskParser fields |
| §9.3 `x 2026-10-30 Call` | Pass | TaskParser fields |
| §9.4 `Fix bug #482 in tracker` | Pass | No id, no tags, validator clean |
| §9.5 `Email a+b@example` | Pass | No project, no context |
| §9.6 `Task id:3 id:4` | Pass | id 3, `duplicate-key` error |
| §9.7 `Task parent:3 parent:4` | Pass | parent 3, `second-parent` error |
| §9.8 `Task parent:99` | Pass | Renders at root, `parent-missing` error. UI render checked in `samples/problems` copy (Inbox) |
| §9.9 `(a) lowercase` | Pass | No priority, text kept |

### §2 (supporting)

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §2.2 Reopen restores `(A)` to line start, round trip exact | Pass | Serializer complete then reopen |
| §2.3 Token rules (bare `+`/`@`, empty key or value, `/` values, first key wins) | Pass | Parser |

### §3 Extensions

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §3 Project underscores display as spaces | Pass | `displayName`; "Home Office" section title |
| §3 Context shown as badge | Pass | Demo render, `.badge-context` |
| §3 Due date: sort and overdue/soon/later kinds | Pass | `dueKind` at the 3-day boundary (11-02 and 11-05 soon, 11-06 later); sort in §5.2 row |
| §3 Numeric and semantic ids | Pass | Parser (`id:db-init`) |
| §3.1 Multi-level `parent:` tree; many children per parent | Pass | TaskList depth 4 |
| §3.1 At most one parent; second is an error, first wins | Pass | Same as §9.7 |
| §3.1 One `dep:` per task | Pass | Second `dep:` reports `duplicate-key` |
| §3.1 `dep:` crosses projects and does not move the task | Pass | Two projects, roots unchanged |
| §3.2 Subtask inherits root project, may omit `+project` | Pass | `effectiveProject`, nested depth 3 |
| §3.2 Naming a different project is a validation error, subtask still renders under parent with error badge | Pass | `samples/problems` line 18 in UI |
| §3.2 Subtask under a no-project root may not name a project | Pass | Validator `project-mismatch` |
| §3.2 + Subtask writes root project (also on a nested subtask) | Pass | Inline input appends ` +Infra parent:3` |
| §3.2 Inline edit changing a subtask's project is rejected with a message | Pass | UI edit, file unchanged, editor stays open |
| §3.2 Adding `parent:` to a task in another project is rejected | Pass | UI edit and add input |
| §3.2 Root project change blocked while subtasks name the old project | Pass | EditRules (extra, sensible) |
| §3.3 IDs unique across both files | Pass | `duplicate-id` on todo and done |
| §3.3 Next id is highest numeric in either file plus 1, semantic ignored | Pass | Rules, and UI (demo gave `id:52`; done.txt holds 50, 51) |
| §3.3 Ids never reused after archiving | Pass | done-only max counts |
| §3.3 Duplicate id: references resolve to first in todo.txt, every duplicate reported | Pass | `byId`, validator |
| §3.4 Normal / dep to done.txt satisfied (no pill, no confirm) | Pass | Rules and UI |
| §3.4 `parent:` to done.txt only: root plus error | Pass | `parent-archived` |
| §3.4 Missing target: root (parent) or ignored (dep), error | Pass | Rules, UI (no pill) |
| §3.4 Parent cycle and self-reference: first in file order at root, error on members | Pass | Rules and UI |
| §3.4 Dep cycle: error on every member, still overridable | Pass | UI override on a 2-cycle |
| §3.5 Untouched lines byte-identical (spacing, tabs, blanks, CRLF, no final newline) | Pass | Round trip LF and CRLF; complete changes exactly one line |
| §3.5 Sorting is view-only | Pass | List text unchanged after sort |

### §4 Completion and visibility

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §4.1 Parent completion blocked while any descendant open (deep) | Pass | Rules; UI lock |
| §4.1 Lock shows tooltip "Complete N remaining subtasks first" | Pass | `title` text. Wording is "subtask" when N is 1 |
| §4.1 Clicking lock highlights open descendants, no write | Pass | `is-flash` on rows 2,3,5,6; zero PUTs; also expands collapsed rows |
| §4.1 Reopening a subtask reopens every completed ancestor | Pass | Rules; UI diff shows exactly 2 changed lines |
| §4.1 Parent complete in file with open subtasks: warning, stays visible | Pass | `completed-parent-open-children`; anchor with Hide Completed on |
| §4.2 "Blocked by #ID" pill when target incomplete | Pass | UI. A1 resolved: pill shows on open tasks only |
| §4.2 Pill click scrolls to and highlights target (expands collapsed row or section) | Pass | `scrollIntoView` call, `is-flash`, focus on checkbox. Visual result is in the checklist |
| §4.2 Override asks "#12 is not complete. Complete anyway?", keeps `dep:` | Pass | Decline writes nothing; confirm writes `x ... dep:2` |
| §4.3 Off: all tasks shown | Pass | Row counts |
| §4.3 On: fully complete subtrees hidden | Pass | 32 rows down to 18 on demo |
| §4.3 On: completed with open descendant stays, with warning badge | Pass | "Open subtasks" badge, yellow |
| §4.3 Counters and progress bars still count hidden tasks | Pass | Header counts, bars, subtask counters unchanged |
| §4.3 Persisted per browser | Pass | `taskflow.hideCompleted`; fresh App restores; blocked storage tolerated |

### §6 Sweeping

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §6 Button with badge of qualifying task count | Pass | Demo shows 4; aria-disabled at 0 |
| §6.1.1 Whole subtree must be complete | Pass | SweepRules |
| §6.1.2 Latest completion date at least 30 calendar days back | Pass | Exactly 30 days qualifies, 29 does not; leap-year span |
| §6.1.3 No incomplete task depends on anything in the subtree | Pass | Dep on root and on a descendant both block; completed dependent does not |
| §6.1 Completed subtask swept while parent open | Pass | Rules |
| §6.1 Completed parent with open descendant never swept | Pass | Rules |
| §6.1 Parent counter covers only remaining subtasks; no dangling refs | Pass | 0/1 after sweep, validator clean |
| §6.2 Append unchanged in original order, then remove, in one save | Pass | Demo sweep: done.txt got 4 lines in order; one PUT; validator clean after |
| §6.2 Toast "Swept N tasks to done.txt." | Pass | Text for N=4. For N=1 it reads "Swept 1 task to done.txt." |
| §6.2 Failure between steps duplicates, never loses | Pass | Forced the todo.txt write to fail after done.txt: done.txt appended, todo.txt untouched |

### §7.2 Client

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §7.2 On `changed`: reload keeps section and row collapse, scroll, open edit with draft | Pass | Fake DOM; `scrollTo(321)` replayed. Real scroll is in the checklist |
| §7.2 Every action saves immediately | Pass | PUT completes within 60 ms of click |
| §7.2 409: reload, re-apply by `id:` or exact text (complete, add, +Subtask with new id, sweep) | Pass | External write before the action; both changes kept; new parent id re-allocated on fresh content |
| §7.2 Line gone: action dropped with toast | Pass | "That task no longer exists." for removed line and for an edited id-less line |
| §7.2 Open inline edit survives external change; save applies to fresh content | Pass | Draft kept; saved line plus agent line both on disk |
| §7.2 `localStorage` holds only collapse state and Hide Completed | Pass | Source scan: two keys only |

### §8 Validator and §5 (checkable parts)

| Rule / example | Result | How checked |
| :--- | :--- | :--- |
| §8 Exit 0 with warnings only, 1 with errors, 2 for bad dir; line format | Pass | CLI runs |
| §8 demo clean; problems matches `expected.txt` | Pass | Diff identical |
| §5.1 Accordions, Inbox first, header counts, top priority, progress, collapse saved | Pass | Demo UI |
| §5.1 Expand All / Collapse All | Pass | Fake DOM |
| §5.2 Sort order (open, priority, due, created, file order) | Pass | SortOrder unit |
| §5.3 + Subtask: nothing written on click; parent with no id gets one in the same save | Pass | One PUT with both lines |
| §5.3 "The only edits rejected are the project-mismatch cases" | **Fail** | Code rejects more. See F1 |
| §5.4 Add input stamps today's date; keeps existing date; priority first | Pass | Server round trip |
| §5.5 Raw drawer edits and saves both files, re-renders | Pass | Fake DOM |
| §5.6 Problems badge count, list with file, line, message; click scrolls and flashes | Pass | `samples/problems`: 15 problems |
| §5.7 No raw hex outside `:root`; tokens match the PRD table | Pass | CSS scan |
| §5.7 No shadows or gradients | Pass | Two `box-shadow` uses: a focus-style inset ring (`.is-flash`) and a 1px hover underline. No drop shadows. See A5 |
| §5.7 Colors, contrast, tree guide colors, focus ring, phone layout | Not verifiable without a browser | See checklist |

### Tally

79 rows: 77 Pass, 1 Fail (F1), 1 Not verifiable without a browser. 169 scripted checks ran (the 79 rows aggregate them); the A1 pill observation was reported as an ambiguity and is now resolved (11.9).

## 2. Failures

### F1. Edit and add reject more than §5.3 allows

PRD §5.3: "The only edits rejected are the project-mismatch cases in §3.2." `EditRules` and `NewTaskRules` also reject the cases below. They look deliberate and sensible, so this is probably a PRD update. Your call.

Repro (any scratch copy of `samples/demo`, inline edit via the description button, or the add input):

| Action | Result |
| :--- | :--- |
| Edit a task to `... id:3` when `id:3` exists | Rejected: "id:3 already exists." |
| Edit an id-bearing task and change its id | Rejected: "IDs never change." |
| Edit to `parent:99` (missing) or `parent:50` (done.txt) | Rejected: "parent:99 is not a task in todo.txt." |
| Edit that makes a task its own ancestor | Rejected |
| Edit to an empty line, or remove all words | Rejected ("Deletion isn't supported yet.", "Enter a task description.") |
| Edit that adds or removes the `x` prefix | Rejected: "Use the checkbox to complete or reopen." |
| Add input `x 2026-11-01 done thing` | Rejected: "Add open tasks only." |
| Add input with an existing id, or `parent:` to a missing or done.txt task | Rejected |

Accepted, as the PRD implies: a second `parent:` token, a repeated key. The Problems panel then reports them.

## 3. Ambiguities and observations

- **A1. Completed row still shows "Blocked by #ID". Resolved (11.9).** `TaskList.isBlocked` now returns false for completed tasks, so the pill is gone after an override while `dep:` stays on the line. PRD §4.2 now says "open task".
- **A2. Edit vs external change of the same line.** §7.2 says to re-apply by `id:` or exact text. Inline edit replaces the whole line, so re-applying would overwrite the agent's change. The code instead refuses when the line text changed: "That task changed on disk. Your edit was not saved." The editor stays open with the draft. Safer, but not literally the PRD rule.
- **A3. Completed task with no completion date is never swept.** Not in the PRD. The validator warns `missing-completion-date`.
- **A4. Singular wording.** Lock tooltip says "1 remaining subtask", toast says "Swept 1 task". The PRD only gives the plural.
- **A5. `box-shadow` is used twice** (flash ring, hover underline). Fine in spirit, contrary to "no shadows" in letter.
- **A6. PRD §8 check list is shorter than the code.** The validator also reports `missing-completion-date` and `loose-date` (warnings), both documented in FORMAT.md.
- **A7. Sweep depends on today's date.** Demo sweeps 4 tasks as of 2026-11-02. "Refresh brand assets" (2026-10-28) joins on 2026-11-27, so the count changes as the sample ages.

## 4. Browser checklist

Setup: `cp -R samples/demo /tmp/demo-ui && PORT=3300 node server.js /tmp/demo-ui`, open http://localhost:3300. Repeat steps against a fresh copy when a step changes data.

1. **Hover visibility.** Desktop width. "+ Subtask" is hidden on rows until you hover; Tab to a row and confirm it appears on keyboard focus. At 375 px wide (DevTools) it is always visible.
2. **Phone width.** DevTools at 375 px. No horizontal scroll anywhere, 16 px side padding (32 px on desktop), tail (pills, counter, id) drops under the text, toggle and checkbox are 32 px.
3. **Focus ring.** Tab through toolbar, rows, checkboxes. Ring is yellow and not clipped inside project headers and toggles.
4. **Lock and highlight.** Hover the lock on "Plan data center rack upgrade". Tooltip reads "Complete 4 remaining subtasks first". Click it. The four open subtasks flash with a yellow ring for about 1.5 s. Collapse the row first and repeat: it opens.
5. **Blocked-by pill.** Click "Blocked by #2" on "Order rack hardware". Page smooth-scrolls so "Get vendor quotes" is centred, it flashes, and its checkbox has focus. With OS "reduce motion" on it jumps instead. Collapse the Infra section first and repeat: it reopens.
6. **Override dialog.** Click the checkbox on "Order rack hardware". Native confirm reads "#2 is not complete. Complete anyway?". Cancel changes nothing. OK writes `x ...` with `dep:2` kept.
7. **Raw drawer.** Click Raw text. Drawer slides in, focus moves to the todo.txt textarea, Tab stays inside, Escape closes, focus returns to Raw text. At 375 px it fits the screen. Edit and Save re-renders.
8. **Toasts.** Click Sweep. Toast "Swept 4 tasks to done.txt." appears top-center, disappears after about 4 s, and the x dismisses it. Trigger several errors (see step 10) and confirm at most 5 stack.
9. **Live reload.** With the page open, append a line to `/tmp/demo-ui/todo.txt` in an editor. It appears within about a second. Scroll down, collapse a section, open an inline edit, then change the file again: scroll, collapse state and the open edit survive. Kill the server and watch the dot turn "Reconnecting", then restart and watch it return to "Live".
10. **Inline edit.** Click "Fix cable management". Caret lands at the end, Enter saves, Escape cancels. Add `+Website` to a subtask of an Infra task: error toast, editor stays open.
11. **Add input and + Subtask.** Click + Subtask on "Replace desk lamp" (no id). A one-line input opens under the row, indented, and is focused. Type only a description, press Enter. The parent gets `id:52` and the new line has `+Home_Office parent:52`, the date and `by:me`, in one save. The input stays open and empty; Escape closes it.
12. **Problems panel.** Run the server on a copy of `samples/problems`. Badge reads 21 problems, red. Open it, click "owner:" item: the page scrolls to that row and flashes it. Confirm the wrong-project child renders under "Beta root" with an Error badge.
13. **Hide Completed and collapse persistence.** Tick Hide Completed, collapse a section, reload the page: both persist. Open a private window: neither is set.
14. **Colors.** Priority (A) red, (B) yellow, (C) green, others teal. Due: overdue red, within 3 days yellow, later green. All three are badges. Project accents rotate green, yellow, teal, red in order of appearance. Inbox muted. Completed rows muted with strikethrough and green check. Tree guide lines step through the rotation per depth. Red and teal are only used as fills.
15. **Two tabs.** Open two tabs. Complete a task in one: the other updates once. The tab that saved does not flicker or re-render twice.
16. **Tags.** On the demo copy: "Audit page load speed" shows a pulsing yellow "Opus 5.5 working" pill (still under reduced motion). "Buy birthday gift" shows a red Human pill first in its row, and the summary shows "1 need you"; clicking the summary jumps to it, clicking the pill asks to clear and OK removes `needs:human`. Author badges sit before the `#id`: muted "me", teal "Opus 5.5" / "Flash 3.1". Agent badges are distinguishable from `@context` badges.
17. **Age.** Open rows show a muted age (`3D`, `1M`) left of the author badge; hovering shows "Created YYYY-MM-DD". Completed rows show none.
18. **New and edited markers.** Load the page once (baseline). Append an id'd line to the file: it appears with a yellow dot and bold text. Change another id'd line's `due:` in the file: that row gets a hollow teal ring, and hovering the ring or the text shows "Edited: due … → …". Both stay until the pointer moves over the row (or you click or focus it), then fade out. Neither clears on its own, however long the tab is in front. Hovering a subtask leaves its parent's marker alone.
19. **Rollup and seen rules.** Collapse a parent, then append a child of it to the file: the parent shows "+1 new" next to its counter, and a collapsed section header shows the same. The marker stays while collapsed, in a background tab, and while you hover the collapsed parent itself. Expand: nothing clears yet. Move the pointer over the new child: its dot fades, the pill disappears (or shrinks if more are marked), and the page does not jump or lose focus.
