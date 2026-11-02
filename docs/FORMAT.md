# todo.txt format guide for agents

TaskFlow keeps tasks in two plain text files, `data/todo.txt` (open and recently completed work) and `data/done.txt` (the archive). One line is one task. You may edit both files directly, and the web app may be open at the same time. The app cannot overwrite your edits: its saves are rejected if either file changed since it last read them.

**Golden rule:** after every edit, run `node validate.js` from the repo root. Fix every error. Read every warning and fix it unless the user wants it that way. Exit code 0 means no errors, 1 means errors exist.

## Line anatomy

Active task: `[(P) ]CREATION description`. Every open line must start with a creation date (after the priority, if any).

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
| `wip:Model_version` | In progress. Add it (e.g. `wip:Opus_5.5`) when you start on a task. Remove it when you stop or finish it. |
| `by:Model_version` | Author. Every line you create must include it, e.g. `by:Opus_5.5` (no spaces). The app uses `by:me` for the user. Never change an existing `by:`. |

Other `key:value` words (letters, digits, `_`, `-` in the key) are kept as tags and ignored. A value starting with `/` is not a tag, so URLs are safe. `#`, `^`, `~` and `!` have no meaning. `#482` is plain text. A bare `+` or `@` is plain text, and so is `a+b@c`.

## Editing rules

- One task per line. Never indent a line. Nesting exists only through `parent:`.
- Do not reorder, reformat, re-space or "tidy" lines you are not changing. Keep unknown tokens, blank lines and the file's line endings and final newline.
- Never repeat a key on one line (`id:3 id:4`). The first value wins and the validator reports an error.
- Make each file change as a single write, not a series of partial writes.

## How to

**Add a task:** append a line with today's creation date: `2026-11-02 Order rack mounts +Infrastructure @office by:Opus_5.5`.

**Complete a task:** replace the line with `x TODAY` plus the creation date (if any), the priority (if any), then the description unchanged.
`(A) 2026-10-30 Call +Infra id:10` becomes `x 2026-11-02 2026-10-30 (A) Call +Infra id:10`. Leave `dep:` and every other token in place.

**Reopen a task:** drop `x` and the completion date, and put the priority first, then the creation date.
`x 2026-11-02 2026-10-30 (A) Call +Infra id:10` becomes `(A) 2026-10-30 Call +Infra id:10`.

**Add a subtask:** give the parent an `id:` if it has none (see IDs), then add a line with `parent:ID`. Either omit the project or use the root task's primary project. A subtask may not name a different project, and a subtask under a root with no project may not name one at all.

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
Pick team lunch spot @office
x 2026-11-01 2026-10-30 Renew license +Ops id:4
```

Line 3 is blocked until line 2 is complete. Line 5 has no project, so it lives in Inbox.
