import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { Pool } from 'pg';
import { z } from 'zod';
import type { Sql } from './database.js';
import {
  mergeNotes,
  parseWorkingMemory,
  readMemoryTurns,
  type ConversationMemory,
  type MemoryContext,
  type MemoryNote,
} from './memory.js';

const CONTEXT_TIMEOUT = 2000;
const OBSERVATION_TOKENS = 8000;
const workingMemorySchema = z.object({
  taskDetails: z.array(z.string()).optional(),
  deadlines: z.array(z.string()).optional(),
  preferences: z.array(z.string()).optional(),
});

const fail = (code: string) => console.error(JSON.stringify({ code }));

export class MastraMemory implements ConversationMemory {
  private readonly memory: Memory;
  private readonly threads = new Set<string>();
  private readonly observing = new Map<string, boolean>();
  constructor(
    private readonly pool: Pool,
    private readonly sql: Sql,
    model: string,
  ) {
    this.memory = new Memory({
      storage: MastraMemory.store(pool, true),
      options: {
        lastMessages: false,
        workingMemory: {
          enabled: true,
          scope: 'thread',
          schema: workingMemorySchema,
        },
        observationalMemory: {
          model: `openai/${model}`,
          observation: {
            messageTokens: OBSERVATION_TOKENS,
            bufferTokens: false,
          },
        },
      },
    });
  }

  static store(pool: Pool, disableInit = false) {
    return new PostgresStore({
      id: 'persona-memory',
      pool,
      schemaName: 'mastra',
      disableInit,
    });
  }

  async context(conversationId: string): Promise<MemoryContext | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.load(conversationId),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            fail('MEMORY_CONTEXT_TIMEOUT');
            resolve(null);
          }, CONTEXT_TIMEOUT);
        }),
      ]);
    } catch {
      fail('MEMORY_CONTEXT_FAILED');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async load(conversationId: string): Promise<MemoryContext> {
    const om = await this.memory.omEngine;
    const [record, working] = await Promise.all([
      om?.getRecord(conversationId, conversationId),
      this.memory.getWorkingMemory({
        threadId: conversationId,
        resourceId: conversationId,
      }),
    ]);
    return {
      observations: record?.activeObservations?.trim() || null,
      workingMemory: parseWorkingMemory(working),
      lastObservedAt: record?.lastObservedAt
        ? new Date(record.lastObservedAt)
        : null,
      observedTurnIds: Array.isArray(record?.observedMessageIds)
        ? record.observedMessageIds
        : [],
    };
  }

  // At most one observation runs per conversation; a request that arrives
  // meanwhile schedules one more pass instead of racing the first.
  async observe(conversationId: string) {
    if (this.observing.has(conversationId)) {
      this.observing.set(conversationId, true);
      return;
    }
    this.observing.set(conversationId, false);
    try {
      do {
        this.observing.set(conversationId, false);
        await this.observeOnce(conversationId);
      } while (this.observing.get(conversationId));
    } catch {
      fail('MEMORY_OBSERVE_FAILED');
    } finally {
      this.observing.delete(conversationId);
    }
  }

  private async observeOnce(conversationId: string) {
    const turns = await readMemoryTurns(this.sql, conversationId);
    if (!turns.length) return;
    await this.thread(conversationId);
    const om = await this.memory.omEngine;
    await om?.observe({
      threadId: conversationId,
      resourceId: conversationId,
      messages: turns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        createdAt: new Date(turn.createdAt),
        threadId: conversationId,
        resourceId: conversationId,
        content: { format: 2, parts: [{ type: 'text', text: turn.content }] },
      })),
    });
  }

  async remember(conversationId: string, notes: MemoryNote[]) {
    if (!notes.length) return false;
    try {
      await this.thread(conversationId);
      const current = parseWorkingMemory(
        await this.memory.getWorkingMemory({
          threadId: conversationId,
          resourceId: conversationId,
        }),
      );
      await this.memory.updateWorkingMemory({
        threadId: conversationId,
        resourceId: conversationId,
        workingMemory: JSON.stringify(mergeNotes(current, notes)),
      });
      return true;
    } catch {
      fail('MEMORY_REMEMBER_FAILED');
      return false;
    }
  }

  async forget(conversationId: string) {
    try {
      await this.memory.deleteThread(conversationId);
      this.threads.delete(conversationId);
    } catch {
      fail('MEMORY_FORGET_FAILED');
    }
  }

  // Observations are only cleared with their thread, so the thread row must exist
  // before anything is written for the conversation.
  private async thread(conversationId: string) {
    if (this.threads.has(conversationId)) return;
    const existing = await this.memory.getThreadById({
      threadId: conversationId,
    });
    if (!existing) {
      const now = new Date();
      await this.memory.saveThread({
        thread: {
          id: conversationId,
          resourceId: conversationId,
          title: 'Persona onboarding',
          metadata: {},
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    this.threads.add(conversationId);
  }

  async onModuleDestroy() {
    await this.memory.settled();
    await this.pool.end();
  }
}

export function memoryPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
  });
}
