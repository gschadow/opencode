export * as QuestionTool from "./question.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Question } from "@opencode/schema/question"

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "Type your own answer" option is added automatically; don't include a separate option for free form answers
- Set \`multiple: true\` to allow selecting more than one option
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

export const Input = Schema.Struct({
  questions: Schema.Array(Question.Prompt).check(Schema.isNonEmpty()).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})
export type Output = typeof Output.Type

export class CancelledError extends Schema.TaggedError<CancelledError>()("QuestionTool.CancelledError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export const toModelContent = (questions: ReadonlyArray<Question.Prompt>, answers: ReadonlyArray<Question.Answer>) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

export const Plugin = {
  id: "opencode.tool.question",
  effect: Effect.fn("QuestionTool.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })),
                Effect.andThen(
                  askQuestions(forms, input.questions, {
                    sessionID: context.sessionID,
                    metadata: {
                      kind: "question",
                      tool: { messageID: context.messageID, id: context.id },
                    },
                    fields: [
                      toField(input.questions[0], 0),
                      ...input.questions.slice(1).map((question, index) => toField(question, index + 1)),
                    ],
                  }),
                ),
                Effect.flatMap((state) => {
                  // Deliberate defect tunnel (see Permission.assert): a dismissal must dodge
                  // leaf `mapError` blankets so it never becomes model-facing tool output; it
                  // resurfaces as a typed failure at SessionModelRequest.executeTool.
                  // A dismissal with a message (e.g. from a non-interactive client) is ordinary
                  // model-facing feedback: the model continues instead of the step ending.
                  if (state.status === "cancelled" && state.message !== undefined)
                    return Effect.fail(new ToolFailure({ message: state.message }))
                  if (state.status === "cancelled") return Effect.die(new CancelledError())
                  const output = {
                    answers: input.questions.map((_, index): Question.Answer => {
                      const value = state.answer[`q${index}`]
                      if (value === undefined) return []
                      if (typeof value === "object") return Array.from(value)
                      return [String(value)]
                    }),
                  }
                  return Effect.succeed({
                    output,
                    content: toModelContent(input.questions, output.answers),
                    metadata: { answers: output.answers },
                  })
                }),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

// An unattended question must not stall the session forever. After this deadline the
// recommended option is taken when every question has exactly one; otherwise the form is
// cancelled, which surfaces as the usual CancelledError dismissal.
const QUESTION_TIMEOUT = "5 minutes"

function recommendedAnswer(question: Question.Prompt): ReadonlyArray<string> | undefined {
  const recommended = question.options.filter((option) => option.label.endsWith("(Recommended)"))
  if (recommended.length !== 1) return undefined
  return [recommended[0].label]
}

function askQuestions(
  forms: Form.Interface,
  questions: ReadonlyArray<Question.Prompt>,
  input: {
    readonly sessionID: Form.Info["sessionID"]
    readonly metadata: Form.Info["metadata"]
    readonly fields: Parameters<Form.Interface["create"]>[0]["fields"]
  },
) {
  const id = Form.ID.create()
  const automatic = questions.map(recommendedAnswer)
  const autoAnswerable = automatic.every((answer): answer is ReadonlyArray<string> => answer !== undefined)
  return Effect.gen(function* () {
    yield* forms
      .create({
        id,
        sessionID: input.sessionID,
        title: "Questions",
        metadata: input.metadata,
        fields: input.fields,
      })
      .pipe(Effect.orDie)
    const wait = forms.wait(id).pipe(Effect.orDie)
    const settled = autoAnswerable
      ? wait.pipe(
          Effect.timeoutOrElse({
            duration: QUESTION_TIMEOUT,
            orElse: () =>
              Effect.gen(function* () {
                yield* Effect.logInfo("auto-answering question on timeout", { requestID: id })
                const answer = Object.fromEntries(
                  questions.map((question, index) => {
                    const labels = automatic[index] ?? []
                    return [`q${index}`, question.multiple === true ? [...labels] : (labels[0] ?? "")]
                  }),
                )
                yield* forms.reply({ id, answer }).pipe(Effect.orDie)
                return yield* wait
              }),
          }),
        )
      : wait
    return yield* settled.pipe(Effect.onInterrupt(() => Effect.ignore(forms.cancel(id))))
  })
}

function toField(question: Question.Prompt, index: number): Form.Field {
  return {
    key: `q${index}`,
    title: question.header,
    description: question.question,
    type: question.multiple === true ? "multiselect" : "string",
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom: true,
  }
}
