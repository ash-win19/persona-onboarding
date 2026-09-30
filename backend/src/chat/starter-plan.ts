import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const evidence = z.string().min(1).max(8000);
export const intakeInputSchema = z
  .object({
    tasks: z
      .array(
        z.object({ value: z.string().min(1).max(2000), evidence }).strict(),
      )
      .max(12),
    replaceTasks: z.boolean(),
    noTasksEvidence: evidence.nullable(),
  })
  .strict();
export type IntakeInput = z.infer<typeof intakeInputSchema>;
// The saved task list shown on the dashboard. Onboarding accepts it
// automatically when it finishes; there is no separate approval step.
export type StarterPlan = {
  id: string;
  steps: string[];
  presented: boolean;
  accepted: boolean;
};
// questionsAsked and clarification are kept so older saved rows still parse.
export type Intake = {
  tasks: string[];
  noTasks: boolean;
  questionsAsked: number;
  clarification: string | null;
  plan: StarterPlan | null;
};
export const emptyIntake = (): Intake => ({
  tasks: [],
  noTasks: false,
  questionsAsked: 0,
  clarification: null,
  plan: null,
});

// Only apply after the coordinator has validated each evidence quote.
export function updateIntake(
  current: Intake,
  input: IntakeInput | undefined,
  task?: string,
): Intake {
  const next: Intake = structuredClone(current);
  const additions =
    input?.tasks.map((t) => t.value.trim()) ?? (task ? [task] : []);
  if (input?.replaceTasks) next.tasks = [];
  for (const value of additions)
    if (
      !next.tasks.some(
        (t) => t.toLocaleLowerCase() === value.toLocaleLowerCase(),
      )
    )
      next.tasks.push(value);
  next.tasks = next.tasks.slice(0, 12);
  if (additions.length) next.noTasks = false;
  if (input?.noTasksEvidence) {
    next.tasks = [];
    next.noTasks = true;
  }
  next.clarification = null;
  const changed =
    JSON.stringify(next.tasks) !== JSON.stringify(current.tasks) ||
    next.noTasks !== current.noTasks;
  if (changed || !current.plan) next.plan = planFor(next);
  return next;
}

export function planFor(intake: Intake): StarterPlan | null {
  const steps = intake.noTasks
    ? ['Your Persona is ready whenever you have something you want help with.']
    : intake.tasks
        .slice(0, 3)
        .map((t, i) => `${i ? 'Then work on' : 'Start with'}: ${t}`);
  return steps.length
    ? { id: randomUUID(), steps, presented: false, accepted: false }
    : null;
}
