// IDs are never reused, so the highest numeric id in either file sets the floor.
export class IdAllocator {
  static next(taskList) {
    let max = 0;
    for (const task of [...taskList.todoTasks, ...taskList.doneTasks]) {
      if (/^\d+$/.test(task.id ?? '')) max = Math.max(max, Number(task.id));
    }
    return String(max + 1);
  }
}
