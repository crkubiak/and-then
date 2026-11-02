# todo.txt format guide for agents

TaskFlow keeps tasks in two plain text files, `data/todo.txt` (open and recently completed work) and `data/done.txt` (the archive). One line is one task. You may edit both files directly, and the web app may be open at the same time. The app cannot overwrite your edits: its saves are rejected if either file changed since it last read them.

**Golden rule:** after every edit, run `node validate.js <folder>` from the repo root, where `<folder>` is the folder holding the files you edited (the one the server was started on). With no argument it checks `data/`. Fix every error. Read every warning and fix it unless the user wants it that way. Exit code 0 means no errors, 1 means errors exist, 2 means the folder was not found.

## Line anatomy

Active task: `[(P) ]CREATION description`

```
(A) 2026-10-30 Call supplier +Infrastructure @phone id:10 parent:8 dep:5 due:2026-11-15
```

Completed task: `x COMPLETION [CREATION ][(P) ]description`

```
x 2026-11-02 2026-10-30 (A) Call supplier +Infrastructure @phone id:10
```

- Priority is `(A)` to `(Z)`, uppercase, followed by a space. On an active line it must be first, before the creation date. `(a)` or `2026-10-30 (A) Call` is plain text, not a priority.
- On a completed line the priority stays after the dates.
- Dates are `YYYY-MM-DD` in local time. A date is only read in the leading position.
- Everything after the markers is the description. Tokens are whitespace-separated words.

## Tokens

| Token | Meaning |
| :--- | :--- |
| `+name` | Project. The first `+name` on a root task is its primary project. Later ones are badges. Root tasks with none go in Inbox. |
| `@name` | Context. Any number. |
| `due:YYYY-MM-DD` | Due date. |
| `id:ID` | Unique ID, numeric (`id:12`) or semantic (`id:db-init`). |
| `parent:ID` | Nests the task under that task. |
| `dep:ID` | Blocked until that task is complete. |
| `by:`, `wip:`, `needs:human` | Agent tags. See Tags agents manage. |

Other `key:value` words (letters, digits, `_`, `-` in the key) are kept as tags and ignored. A value starting with `/` is not a tag, so URLs are safe. `#`, `^`, `~` and `!` have no meaning. `#482` is plain text. A bare `+` or `@` is plain text, and so is `a+b@c`.

## Editing rules

- One task per line. Never indent a line. Nesting exists only through `parent:`.
- Do not reorder, reformat, re-space or "tidy" lines you are not changing. Keep unknown tokens, blank lines and the file's line endings and final newline.
- Never repeat a key on one line (`id:3 id:4`). The first value wins and the validator reports an error.
- Make each file change as a single write, not a series of partial writes.

## How to

**Add a task:** append a line with today's creation date and your `by:` tag: `2026-11-02 Order rack mounts +Infrastructure @office by:Opus_5.5`.

**Complete a task:** replace the line with `x TODAY`, the creation date, the priority (if any), then the description unchanged.
`(A) 2026-10-30 Call +Infra id:10` becomes `x 2026-11-02 2026-10-30 (A) Call +Infra id:10`. Leave `dep:` and every other token in place, except `wip:` and `needs:` (see Tags agents manage).

**Reopen a task:** drop `x` and the completion date, and put the priority first, then the creation date.
`x 2026-11-02 2026-10-30 (A) Call +Infra id:10` becomes `(A) 2026-10-30 Call +Infra id:10`.

**Add a subtask:** give the parent an `id:` if it has none (see IDs), then add a line with `parent:ID`. Either omit the project or use the root task's primary project. A subtask may not name a different project, and a subtask under a root with no project may not name one at all.

## Tags agents manage

Write these exactly as shown. A `Model_version` value has no spaces (`Opus_5.5`, `Flash_3.1`). Underscores display as spaces. Never repeat a key on one line.

### Creation date

- **Means:** when the task was created.
- **Syntax:** `YYYY-MM-DD`, directly after the priority if there is one: `(A) 2026-11-02 Call supplier`.
- **Add:** on every open line you write, with today's date. A task with no date gets today's date.
- **Change or remove:** keep it. It carries over to the completed line (`x 2026-11-03 2026-11-02 ...`). Completed lines and `done.txt` may lack one.
- **App:** shows an age badge on open tasks (`3D`, `2M`, `1Y`), computed at render time and never stored. The add input and inline edit enforce it.
- **Validator:** `missing-creation-date` (error), `bad-date` (error), `loose-date` (warning).

### `by:`

- **Means:** who created the task. `by:me` is the user. You are `by:<Model>_<version>`.
- **Syntax:** `by:Opus_5.5`.
- **Add:** on every line you create, including subtasks.
- **Change or remove:** never. Do not add one to a line you did not create. The app refuses edits that change or remove it. A missing `by:` on older lines is fine.
- **App:** hides the token and shows a badge before the ID: muted "me", or a teal badge for an agent.
- **Validator:** none beyond `duplicate-key`.

### `wip:`

- **Means:** an agent is working on this task right now.
- **Syntax:** `wip:Opus_5.5`.
- **Add:** when you start working on an open task.
- **Remove:** when you stop, when you hand the task to the user, and when you complete it.
- **App:** hides the token and shows a pulsing yellow "Opus 5.5 working" pill on open tasks. Completing from the app strips it. Inline edit may add, change or remove it.
- **Validator:** `wip-on-complete` (warning, either file).

### `needs:human`

- **Means:** you are blocked on the user: a decision, credentials or a review.
- **Syntax:** `needs:human`. No other value is supported.
- **Add:** when you cannot continue without the user. Remove your `wip:` in the same edit. Write the question in the task text, or better as a subtask (`parent:` the blocked task) so the user can complete it as the answer.
- **Remove:** only after the user has answered. Then resume with a fresh `wip:`, or leave the task idle.
- **App:** hides the token and shows a red "Human" pill first in the row, and "N need you" in the header, which jumps from task to task. Clicking the Human pill asks to clear it. Completing from the app strips it.
- **Validator:** `needs-on-complete` (warning, either file), `unknown-needs` (warning).

### Other tokens

`id:`, `parent:` and `dep:`: see IDs and Hierarchy and dependencies. `due:`: see Tokens.

### Worked session

Create a task:

```
2026-11-02 Draft rollout plan +Infra id:20 by:Opus_5.5
```

Start work. Add `wip:`:

```
2026-11-02 Draft rollout plan +Infra id:20 by:Opus_5.5 wip:Opus_5.5
```

Blocked on the user. Swap `wip:` for `needs:human` and add the question as a subtask:

```
2026-11-02 Draft rollout plan +Infra id:20 by:Opus_5.5 needs:human
2026-11-02 Which region goes first? parent:20 by:Opus_5.5
```

The user answers: they complete the subtask and clear the Human pill. Check that `needs:human` is gone, then resume:

```
2026-11-02 Draft rollout plan +Infra id:20 by:Opus_5.5 wip:Opus_5.5
x 2026-11-03 2026-11-02 Which region goes first? parent:20 by:Opus_5.5
```

Finish. Complete the line and remove `wip:` (and `needs:` if present):

```
x 2026-11-03 2026-11-02 Draft rollout plan +Infra id:20 by:Opus_5.5
x 2026-11-03 2026-11-02 Which region goes first? parent:20 by:Opus_5.5
```

### Cleanup

- **A `wip:` you did not set:** leave it alone. Remove it only when the user says that agent is not running. The user can also remove it by hand or with inline edit.
- **A `needs:human` you set:** the user clears it (Human pill, or by completing the task). You remove it only after the user has answered.
- **Completed lines:** never leave `wip:` or `needs:` on them. The validator warns on both.

## IDs

- Add an `id:` only when a task needs to be referenced by `parent:` or `dep:`.
- New numeric ID = highest numeric `id:` in **both** files plus 1, or 1 if none. Semantic IDs do not count. Only a task's own `id:` counts, not references to it. Write plain digits with no leading zeros.
- Never reuse an ID, and never change an existing one. IDs must be unique across both files.

## Hierarchy and dependencies

- A task has at most one `parent:` and at most one `dep:`. A parent can have many subtasks, nested to any depth.
- A subtask belongs to the project of its root ancestor.
- Do not complete a parent while any descendant is open. Complete the descendants first.
- Reopening a subtask means reopening every completed ancestor too.
- `dep:ID` means "can't finish until ID is complete". A target in `done.txt` counts as satisfied. A missing target is an error.
- `parent:` and `dep:` must not form cycles, including a task pointing at itself.
- A `parent:` pointing at an ID found only in `done.txt` is an error, so do not archive a parent that still has subtasks in `todo.txt`.

## done.txt

Never edit or reorder existing lines. Sweep only when the user asks. A completed task moves **together with its whole subtree** when all of these hold:

1. Every task in the subtree is complete.
2. The latest completion date in the subtree is at least 30 days before today.
3. No incomplete task in `todo.txt` has a `dep:` on any task in the subtree.

Order matters. First append the lines to `done.txt`, unchanged and in their original order. Then remove them from `todo.txt`. A failure in between then duplicates lines instead of losing them.

## Validator codes

| Code | Severity | Fix |
| :--- | :--- | :--- |
| `duplicate-key` | error | Remove the repeated key. |
| `second-parent` | error | Keep one `parent:`. |
| `duplicate-id` | error | Give the task that reused the ID by mistake a new ID (highest + 1). This is the only case where changing an ID is allowed. Ask the user if it is unclear which task that is. |
| `bad-date` | error | Use a real `YYYY-MM-DD` date (also checks `due:`). |
| `loose-date` | warning | A leading date like `2026-1-5` is not read as a date. Rewrite it as `YYYY-MM-DD`. |
| `missing-completion-date` | warning | Add the completion date after `x`. |
| `missing-creation-date` | error | Add a creation date after the priority (today's date if unknown). Open tasks in `todo.txt` only. Completed lines and `done.txt` are exempt. |
| `needs-on-complete` | warning | Remove `needs:` from the completed line. Applies to both files. |
| `unknown-needs` | warning | `needs:` only supports `human`. |
| `wip-on-complete` | warning | Remove `wip:` from the completed line. Applies to both files. |
| `no-description` | warning | The line is only tags, projects and contexts. Add the task text, or delete the line. Applies to open and completed lines in both files. |
| `parent-missing` | error | Point at an existing ID or remove `parent:`. |
| `parent-archived` | error | The parent is in `done.txt`. Remove `parent:` or reopen the parent. |
| `parent-cycle` | error | Remove `parent:` from one task in the loop. |
| `dep-missing` | error | Point at an existing ID or remove `dep:`. |
| `dep-cycle` | error | Remove `dep:` from one task in the loop. |
| `project-mismatch` | error | Remove the subtask's `+project` or use its root's project. |
| `completed-parent-open-children` | warning | Reopen the parent or complete its subtasks. |

## Example

```
(A) 2026-10-30 Plan rack upgrade +Infra id:1 due:2026-11-20
2026-10-30 Get quotes +Infra parent:1 id:2
2026-10-31 Order racks parent:1 id:3 dep:2
(B) 2026-10-30 Book downtime +Infra @phone parent:1
2026-10-31 Pick team lunch spot @office
x 2026-11-01 2026-10-30 Renew license +Ops id:4
```

Line 3 is blocked until line 2 is complete. Line 5 has no project, so it lives in Inbox.
