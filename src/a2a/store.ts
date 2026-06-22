// Bounded task store (1.12.0, roadmap #7). The SDK's stock InMemoryTaskStore is
// an unbounded Map: every A2A task — with its full history and the
// optimized-prompt artifact (which embeds the entire compose result) — lives for
// the process lifetime. For a long-running A2A peer that's a slow memory leak.
//
// This caps the number of retained tasks and evicts the least-recently-touched
// first (Map preserves insertion order, so re-inserting on access gives LRU). It
// implements the same `TaskStore` interface (load/save), so it's a drop-in.

import type { Task } from "@a2a-js/sdk";
import type { TaskStore } from "@a2a-js/sdk/server";

const DEFAULT_MAX_ENTRIES = 1000;

export class BoundedTaskStore implements TaskStore {
  private readonly store = new Map<string, Task>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  async load(taskId: string): Promise<Task | undefined> {
    const task = this.store.get(taskId);
    if (!task) return undefined;
    // Touch: move to the most-recently-used end.
    this.store.delete(taskId);
    this.store.set(taskId, task);
    return { ...task };
  }

  async save(task: Task): Promise<void> {
    this.store.delete(task.id); // re-insert at the MRU end
    this.store.set(task.id, { ...task });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value; // LRU = first key
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
