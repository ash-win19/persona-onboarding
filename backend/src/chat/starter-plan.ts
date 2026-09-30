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
    clarification: z.string().min(1).max(400).nullable(),
    stopQuestionsEvidence: evidence.nullable(),
    plan: z.array(z.string().min(1).max(400)).min(1).max(3).nullable(),
    acceptPlan: z
      .object({ id: z.string().uuid(), evidence })
      .strict()
      .nullable(),
  })
  .strict();
export type IntakeInput = z.infer<typeof intakeInputSchema>;
export type StarterPlan = {
  id: string;
  steps: string[];
  presented: boolean;
  accepted: boolean;
};
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
export const planMessage = (plan: StarterPlan) =>
  `Here's the plan:\n\n${plan.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nDoes this plan work for you?`;

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
  if (
    input?.stopQuestionsEvidence &&
    /question|asking|frustrat|stop this|enough/iu.test(
      input.stopQuestionsEvidence,
    )
  )
    next.questionsAsked = 2;
  if (input?.clarification && next.questionsAsked < 2 && !next.noTasks) {
    next.clarification = input.clarification;
    next.questionsAsked++;
  }
  const changed =
    JSON.stringify(next.tasks) !== JSON.stringify(current.tasks) ||
    next.noTasks !== current.noTasks;
  const steps = next.noTasks
    ? ['Your Persona is ready whenever you have something you want help with.']
    : (input?.plan ??
      (changed || !current.plan
        ? next.tasks
            .slice(0, 3)
            .map((t, i) => `${i ? 'Then work on' : 'Start with'}: ${t}`)
        : current.plan.steps));
  if (
    steps.length &&
    (changed ||
      !current.plan ||
      (input?.plan &&
        JSON.stringify(steps) !== JSON.stringify(current.plan.steps)))
  )
    next.plan = { id: randomUUID(), steps, presented: false, accepted: false };
  if (!steps.length) next.plan = null;
  return next;
}
