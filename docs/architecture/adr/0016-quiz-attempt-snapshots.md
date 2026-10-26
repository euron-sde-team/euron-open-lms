# ADR 0016: Quiz attempts graded against a frozen snapshot

## Status

Accepted.

## Context

Quiz questions live in a per-course bank that authors keep editing: fixing a typo, changing
the correct option, adding questions, archiving others. A RANDOM quiz draws a different set
per attempt, and options are shuffled. An attempt can stay open for hours. If grading read
the live bank, an edit would change an attempt in progress and could regrade history. If
the client sent the question list back, it could add or alter questions.

## Decision

- Starting an attempt freezes a **snapshot** in `quiz_attempts.snapshot`: exactly which
  questions, in which order, each question's option order, the points and the answer key
  (`buildSnapshot` in [`domain/quiz.ts`](../../../apps/api/src/domain/quiz.ts)), shuffled
  with the OS CSPRNG.
- Grading (`grade`) reads only the snapshot and the learner's answers; `cleanAnswers` drops
  anything that is not a question of the snapshot or an option of that question. MULTI is
  all or nothing.
- The snapshot never leaves the API as-is: the attempt presenter builds learner-facing
  questions field by field and adds the key only per the reveal policy.
- Totals are stored on the attempt at close, so a later change of the pass mark does not
  rewrite history.
- A partial unique index allows one open attempt per learner and quiz; the deadline is
  enforced from `deadline_at` on the server.

Details: [assessments.md](../assessments.md).

## Consequences

Positive:

- History is stable; disputes can be answered from the stored snapshot.
- The answer key is in one guarded place per attempt.

Trade-offs:

- A corrected question does not regrade attempts already taken, and there is no regrade
  tool; a learner affected by a wrong key retakes the quiz (raise `max_attempts` if needed).
- Snapshots duplicate question text and keys per attempt.

## Alternatives considered

- **Grade against the live bank.** Edits change open attempts and history.
- **Version the bank.** Exact, but a version table for every question edit is more machinery
  than a per-attempt copy.
