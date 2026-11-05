import { TaskParser } from '../public/js/model/TaskParser.js';
import { TaskSerializer } from '../public/js/model/TaskSerializer.js';
import { IdAllocator } from '../public/js/model/IdAllocator.js';
import { CompletionRules } from '../public/js/rules/CompletionRules.js';
import { EditRules } from '../public/js/rules/EditRules.js';
import { NewTaskRules } from '../public/js/rules/NewTaskRules.js';
import { Validator } from '../public/js/rules/Validator.js';

// A refusal the agent can act on. The message goes back to it as the tool result.
export class ToolError extends Error {}

const AGENT_NAME = /^[A-Za-z][A-Za-z0-9-]*_\d[\w.]*$/; // Model_version, no spaces: Opus_5.5

// Pure edits over a TaskList, following docs/FORMAT.md. Each write returns
// { list, result }: the new TaskList and what to tell the agent. Nothing here touches the network,
// so each can be re-run against fresher files after a 409.
export class Operations {
  static requireAgent(agent) {
    if (!AGENT_NAME.test(agent ?? '')) {
      throw new ToolError('Name yourself as Model_version with no spaces, for example Opus_5.5. Pass `agent`, or set TASKFLOW_AGENT for the server.');
    }
    return agent;
  }

  // ---- reading ----

  static list(taskList, { project, context, status = 'open', needsHuman, wip } = {}) {
    return taskList.todoTasks
      .filter((task) => status === 'all' || (status === 'done') === task.complete)
      .filter((task) => project === undefined || taskList.effectiveProject(task) === project)
      .filter((task) => context === undefined || task.contexts.includes(context))
      .filter((task) => needsHuman === undefined || (task.needs === 'human') === needsHuman)
      .filter((task) => wip === undefined || (task.wip !== null) === wip)
      .map((task) => Operations.describe(taskList, task));
  }

  static describe(taskList, task) {
    return {
      id: task.id,
      line: task.raw,
      text: task.description,
      project: taskList.effectiveProject(task),
      contexts: task.contexts,
      priority: task.priority,
      due: task.due,
      complete: task.complete,
      createdBy: task.by,
      wip: task.wip,
      needsHuman: task.needs === 'human',
      parent: task.parentId,
      dep: task.depId,
      blocked: taskList.isBlocked(task),
    };
  }

  static validate(taskList) {
    return Validator.validate(taskList);
  }

  // ---- writing ----

  static add(taskList, { text, parent, dep }, { agent, today }) {
    Operations.requireAgent(agent);
    const typed = text.trim();
    const parsed = TaskParser.parse(typed, { file: 'todo', lineNumber: 0 });
    if (typed.startsWith('x ')) throw new ToolError('Add open tasks only.');
    if (!parsed || parsed.description === '') throw new ToolError('Enter a task description.');
    if (parsed.by !== null) throw new ToolError('Leave out by:. It is stamped for you.');
    if (parsed.wip !== null) throw new ToolError('Add the task first, then use set_wip.');
    let extras = '';
    for (const [key, value] of [['parent', parent], ['dep', dep]]) {
      if (value === undefined) continue;
      if (Object.hasOwn(parsed.tags, key)) throw new ToolError(`Pass ${key} once: it is already in the text.`);
      extras += ` ${key}:${value}`;
    }
    if (dep !== undefined && !taskList.byId(dep)) throw new ToolError(`dep:${dep} is not a task id.`);
    // Give the task an id so later calls can name it, unless the text already carries one.
    const idToken = parsed.id === null ? ` id:${IdAllocator.next(taskList)}` : '';
    const prepared = NewTaskRules.prepare(taskList, `${typed}${extras}${idToken} by:${agent}`, today);
    if (prepared.error) throw new ToolError(prepared.error);
    const list = taskList.appendLine('todo', prepared.line);
    return { list, result: Operations.describe(list, list.todoTasks.at(-1)) };
  }

  // `line` is the whole replacement line, as list_tasks returns it. Same rules as inline edit in the app.
  static update(taskList, { task: reference, line }) {
    const task = Operations.#resolve(taskList, reference);
    if (task.complete) throw new ToolError('That task is complete. Reopening is for the user.');
    const error = EditRules.check(taskList, task, line);
    if (error) throw new ToolError(error);
    const list = taskList.replaceLine(task, line);
    return { list, result: Operations.describe(list, Operations.#at(list, task)) };
  }

  static complete(taskList, { task: reference, allowBlocked = false }, { today }) {
    const task = Operations.#resolve(taskList, reference);
    const check = CompletionRules.check(taskList, task);
    if (task.complete) throw new ToolError('That task is already complete.');
    if (!check.allowed) {
      const open = check.openDescendants.map((t) => t.id ?? `line ${t.lineNumber}`).join(', ');
      throw new ToolError(`Complete its open subtasks first: ${open}.`);
    }
    if (check.needsConfirm && !allowBlocked) {
      throw new ToolError(`Blocked by dep:${check.blocker.id}. Complete that first, or pass allowBlocked if the user said to finish it anyway.`);
    }
    const list = CompletionRules.complete(taskList, task, today);
    return { list, result: { completed: task.id ?? task.raw } };
  }

  static setWip(taskList, { task: reference, working }, { agent }) {
    Operations.requireAgent(agent);
    const task = Operations.#resolve(taskList, reference);
    if (task.complete) throw new ToolError('That task is complete.');
    if (working) {
      if (task.needs === 'human') throw new ToolError('This task is waiting for the user (needs:human). Do not resume it until they answer.');
      if (task.wip !== null && task.wip !== agent) throw new ToolError(`Another agent is working on this (wip:${task.wip}). Leave it alone.`);
      if (task.wip === agent) return { list: taskList, result: Operations.describe(taskList, task) };
      return Operations.#replaced(taskList, task, TaskSerializer.setTag(task, 'wip', agent));
    }
    if (task.wip === null) return { list: taskList, result: Operations.describe(taskList, task) };
    if (task.wip !== agent) throw new ToolError(`wip:${task.wip} is not yours. Only the user can clear it.`);
    return Operations.#replaced(taskList, task, TaskSerializer.removeTag(task, 'wip'));
  }

  // Marks the task as blocked on the user. Swaps your wip: for needs:human and, with a question,
  // adds it as a subtask the user can complete as their answer.
  static flagNeedsHuman(taskList, { task: reference, question }, { agent, today }) {
    Operations.requireAgent(agent);
    const task = Operations.#resolve(taskList, reference);
    if (task.complete) throw new ToolError('That task is complete.');
    let line = task.raw;
    let current = task;
    if (task.wip === agent) line = TaskSerializer.removeTag(task, 'wip');
    if (task.needs === null) line = TaskSerializer.setTag(TaskParser.parse(line, { file: 'todo', lineNumber: task.lineNumber }), 'needs', 'human');
    let list = line === task.raw ? taskList : taskList.replaceLine(task, line);
    if (question === undefined) return { list, result: { flagged: task.id ?? task.raw } };

    current = Operations.#at(list, task);
    if (current.id === null) {
      list = list.replaceLine(current, TaskSerializer.setTag(current, 'id', IdAllocator.next(list)));
      current = Operations.#at(list, task);
    }
    const prepared = NewTaskRules.prepare(list, `${question.trim()} parent:${current.id} by:${agent}`, today);
    if (prepared.error) throw new ToolError(prepared.error);
    list = list.appendLine('todo', prepared.line);
    return { list, result: { flagged: current.id, question: Operations.describe(list, list.todoTasks.at(-1)) } };
  }

  // ---- internals ----

  // A task is named by its id, or when it has none by its exact line as list_tasks returns it.
  static #resolve(taskList, reference) {
    const byId = taskList.byId(reference);
    if (byId) {
      if (byId.file !== 'todo') throw new ToolError(`id:${reference} is archived in done.txt.`);
      return byId;
    }
    const matches = taskList.todoTasks.filter((t) => t.raw === reference);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new ToolError('Several identical lines match. Name the task by id.');
    throw new ToolError(`No open or completed task in todo.txt has id or line "${Operations.#clip(reference)}". List the tasks again: they may have changed.`);
  }

  static #clip(text) {
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }

  static #replaced(taskList, task, line) {
    const list = taskList.replaceLine(task, line);
    return { list, result: Operations.describe(list, Operations.#at(list, task)) };
  }

  // Edits keep line numbers, so the same line in the new list is the same task.
  static #at(list, task) {
    return list.todoTasks.find((t) => t.lineNumber === task.lineNumber);
  }
}
