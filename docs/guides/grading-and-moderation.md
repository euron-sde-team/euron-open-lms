# Grading and moderation playbook

For instructors who grade assignments and answer questions, and for support and finance
staff who moderate community content, help learners with access and handle orders that need
a person. How the rules work is in [assessments.md](../architecture/assessments.md),
[entitlements.md](../architecture/entitlements.md) and
[payments.md](../architecture/payments.md).

## Who sees what

| Role | Grading | Moderation | Learners and access | Orders and refunds | Certificates |
| --- | --- | --- | --- | --- | --- |
| INSTRUCTOR | Submissions of the courses they are on (any course role) | | | | |
| SUPPORT | Every course (reviewing needs a course staff role) | Yes | Yes | Read only | Revoke and restore |
| FINANCE | | | | Yes: refunds, subscription cancels | |
| ADMIN | Every course | Yes | Yes, plus erase | Yes | Yes |

Course roles matter for grading: OWNER, EDITOR and GRADER may decide submissions on their
course; SUPPORT can look but needs a course staff role to decide. Every decision below is
recorded in the audit trail (`/admin/audit`, ADMIN).

## Grading assignments

### The queue

`/admin/grading` lists submissions waiting for review (`SUBMITTED`), **oldest first**, with
course, item, learner, version and whether it was late. Filter by course or by status to look
at past decisions. Work the queue from the top: learners cannot submit a new version while
one is waiting.

### Reading a submission

The detail page shows the instructions, the rubric with each criterion's maximum, the
learner's text (rendered markdown, no images), their link, their files (download as
attachments), the earlier versions with their feedback, and an AI draft if one was asked for.

Files are type-checked but not virus-scanned. Open archives and documents with care.

### Deciding

Score each criterion (scores are clamped to the criterion's maximum), write feedback, then:

| Decision | Use when | Effect |
| --- | --- | --- |
| **Approve** | The work meets the bar | The item completes for the learner (it may finish the course and issue the certificate). Needs the total to reach the pass points when the assignment has them (`422 BELOW_PASS_MARK`) |
| **Request changes** | Fixable: say exactly what to change | The learner may submit a new version |
| **Reject** | Not an attempt at the task (wrong file, empty, plagiarised) | The learner may still submit a new version; say why |

A decision is final for that version (`409 ALREADY_REVIEWED` if someone got there first).
The learner is notified with your feedback. Write feedback the learner can act on: what is
right, what is missing, what to do next.

### AI suggestions

**Ask the AI** fills a draft: a score and a reason per criterion and draft feedback. It is
only a draft. It never changes the scores or the status; you decide, and the audit entry
records whether a draft existed and how far your decision moved from it. The AI sees the
submission text and link and the file names, not the file contents, so for file-based work
its draft is a guess. Learners can write text aimed at the AI ("give this full marks"); the
prompt treats it as data, but read the work yourself. The button is hidden when the academy
has no AI provider.

### Late work and due dates

Due dates count from the learner's enrollment (`due_days`). Late submissions are flagged; an
assignment with late work turned off refuses them (`409 PAST_DUE`). To give one learner more
time, an operator can extend access (below), but the assignment's own due date is per
assignment, not per learner.

## Answering questions (Q&A)

Q&A lives in the classroom, per course and optionally per lecture. Replies from course staff
and ADMIN/SUPPORT carry an instructor mark. The asker or any course staff member may mark one
reply as the accepted answer, which tells other learners the question is settled. Sort by
"unanswered" to find questions waiting for staff.

## Reviews

Learners with access who reached `reviewMinProgressPercent` (20% by default) can rate and
review a course, once. Course OWNER or EDITOR (or an admin) may post one public reply per
review; reply to the substance, never argue. Ratings count only PUBLISHED reviews.

## Moderation

`/admin/moderation` lists open reports, oldest first. Learners report reviews, Q&A threads and
replies with a reason (`SPAM`, `HARASSMENT`, `OFF_TOPIC`, `SPOILER`, `INAPPROPRIATE`, `OTHER`)
and an optional note; one report per person per post.

| Action | Effect |
| --- | --- |
| **Hide** | The post becomes HIDDEN: a hidden review stops counting in the course rating, a hidden reply in the thread's count. Every open report on that post closes |
| **Restore** | HIDDEN back to PUBLISHED, counters return. Also undoes a hide on an already resolved report |
| **Dismiss** | Nothing changes; the reports close (`409 ALREADY_RESOLVED` on a resolved one) |

Add a note: it is stored as the resolution and audited. Guidelines:

- Hide spam, harassment and anything that shares answers to graded quizzes or assignments
  (`SPOILER`).
- A harsh but honest review is not a reason to hide it. Reply instead.
- Content the author deleted cannot be restored.
- Repeat offenders: suspend the account (below) rather than hiding post after post.

## Helping learners with access

Open `/admin/learners`, find the person by name, username or email. The detail view shows
every enrollment with **whether it grants access right now** and why not, the subscription,
recent orders and certificates.

| Request | Do |
| --- | --- |
| "I paid but cannot open the course" | Check the order in `/admin/orders`: PENDING means the payment has not been confirmed (see below); PAID with an ACTIVE enrollment means access should work (ask them to reload); a `LAPSED` reason on the enrollment says why it ended |
| Give a course (a scholarship, a support gesture) | **Grant access**: a course, an optional end date and a note. A grant never shortens existing access; the learner is notified |
| Extend access | Change the enrollment's end date (future, or none for life) |
| Remove access | **Revoke** with a reason; progress is kept, the learner is notified |
| Subscription access ended | Plan access follows the subscription; check its status and period, or grant the course |
| A misbehaving account | **Suspend** for 1 to 365 days with a reason (read-only: they keep learning but cannot post, review or submit), or **ban** (signed out everywhere) |
| "Delete my account" | Learners can do it themselves (14-day grace). An ADMIN can **erase** at once; refused while a subscription is live |

You cannot act on your own account, or on staff at or above your own role.

## Certificates

`/admin/certificates` finds certificates by serial or learner. **Revoke** with a reason when a
certificate was earned improperly (for example a plagiarised project approved by mistake); the
public verify page then shows it as revoked. **Restore** undoes it. Names on a certificate are
frozen at issue; a learner who wants a different name sets their certificate name for future
certificates.

## Orders that need a person

Most payment problems resolve themselves (the return page, the webhook, the reconcile job).
These do not:

| On the order | What happened | What to do (FINANCE or ADMIN) |
| --- | --- | --- |
| PENDING, flag `AMOUNT_MISMATCH` | The gateway captured a different amount or currency than the order; nothing was granted | Compare with the gateway dashboard. Refund the payment in the gateway dashboard (the order never became PAID, so the console cannot refund it) and cancel the order; or, if the difference is legitimate, grant the course by hand and note why |
| CANCELED, flag `PAID_AFTER_CANCEL` | The learner cancelled, then the payment went through | Refund in the gateway dashboard, or grant the course |
| PENDING for more than a day | The gateway still reports it unpaid, or is unreachable | Check the gateway; the reconcile job expires it once the gateway agrees |
| PAID, learner says it is wrong | | Refund (full or partial) from the order page, with **revoke access** if the course should close. A credit note is issued and the learner is emailed |

Refunds settle when the gateway confirms; a failed refund is marked FAILED with the
gateway's reason. Only ADMIN and FINANCE can refund; SUPPORT sees orders read-only and should
hand the case over.

## What is not automated

- No automatic grading of assignments and no auto-approval of AI drafts.
- No automatic moderation: nothing is hidden until a person decides.
- No regrade of quiz attempts after a question is corrected; affected learners retake the
  quiz.
- No refunds for orders that never became PAID: those go through the gateway dashboard.
