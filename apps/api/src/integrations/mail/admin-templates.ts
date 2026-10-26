/**
 * The words of a notification email (notify.email in jobs/maintenance.jobs.ts): a
 * subject line, one sentence of body and a button label per NotificationType. The
 * snippet is the course, item or order the notification is about; it is plain text
 * (notificationEmail escapes it into the HTML). Pure, so every type is unit-tested.
 */
import type { NotificationType } from "@open-lms/types";

export interface NotificationCopy {
  title: string;
  body: string;
  cta: string;
}

export function notificationCopy(type: NotificationType, snippet: string | null, academy: string): NotificationCopy {
  const what = snippet?.trim() ? `"${snippet.trim()}"` : null;
  switch (type) {
    case "ORDER_PAID":
      return { title: "Your payment went through", body: `Thank you: your order${what ? ` for ${what}` : ""} at ${academy} is paid.`, cta: "View your order" };
    case "ORDER_FAILED":
      return { title: "Your payment did not go through", body: `The payment${what ? ` for ${what}` : ""} was not completed. You can try again with another method.`, cta: "Review the order" };
    case "REFUND_ISSUED":
      return { title: "A refund is on its way", body: `We issued a refund${what ? ` for ${what}` : ""}. It can take a few days to reach your account.`, cta: "View your order" };
    case "ENROLLMENT_GRANTED":
      return { title: `You now have access${what ? ` to ${what}` : " to a new course"}`, body: `A course${what ? `, ${what},` : ""} was added to your learning at ${academy}.`, cta: "Start learning" };
    case "ENROLLMENT_REVOKED":
      return { title: `Your access${what ? ` to ${what}` : " to a course"} ended`, body: `Your enrollment${what ? ` in ${what}` : ""} at ${academy} was ended. Your progress is kept if you enroll again.`, cta: "See the course" };
    case "SUBMISSION_REVIEWED":
      return { title: "Your assignment was reviewed", body: `An instructor reviewed your submission${what ? ` for ${what}` : ""}. Read the feedback when you are ready.`, cta: "Read the feedback" };
    case "CERTIFICATE_ISSUED":
      return { title: "You earned a certificate", body: `Congratulations on completing${what ? ` ${what}` : " your course"}. Your certificate is ready to share.`, cta: "View your certificate" };
    case "SUBSCRIPTION_RENEWED":
      return { title: "Your subscription renewed", body: `Your ${academy} subscription${what ? ` (${what})` : ""} renewed, and your courses stay unlocked.`, cta: "Manage your subscription" };
    case "SUBSCRIPTION_PAYMENT_FAILED":
      return { title: "We could not renew your subscription", body: `The renewal payment${what ? ` for ${what}` : ""} failed. Update your payment method to keep your courses unlocked.`, cta: "Update payment" };
    case "SUBSCRIPTION_CANCELED":
      return { title: "Your subscription was cancelled", body: `Your ${academy} subscription${what ? ` (${what})` : ""} is cancelled. Included courses stay open until the paid period ends.`, cta: "Manage your subscription" };
    case "QA_REPLY":
      return { title: "New reply to your question", body: `Someone replied in the Q&A${what ? ` on ${what}` : ""}.`, cta: "Read the reply" };
    case "QA_ACCEPTED":
      return { title: "Your answer was accepted", body: `Your reply${what ? ` to ${what}` : ""} was marked as the accepted answer.`, cta: "See the thread" };
    case "REVIEW_REPLY":
      return { title: "The instructor replied to your review", body: `There is a reply to your review${what ? ` of ${what}` : ""}.`, cta: "Read the reply" };
    case "COURSE_UPDATED":
      return { title: `${what ?? "A course you take"} was updated`, body: `New material was added${what ? ` to ${what}` : " to a course you are enrolled in"}.`, cta: "See what is new" };
    default:
      return { title: `News from ${academy}`, body: "There is something new for you.", cta: "Open" };
  }
}
