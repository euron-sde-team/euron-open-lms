import { isApiError } from "@open-lms/api-client";

/** Human copy for the API's stable error codes. Unknown codes fall back to the server message. */
const COPY: Record<string, string> = {
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
  SERVER_ERROR: "Something went wrong on our side. Try again in a moment.",
  BAD_GATEWAY: "The service is restarting. Try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again in a moment.",
  GATEWAY_TIMEOUT: "The server took too long to answer. Try again.",
  RATE_LIMITED: "You are doing that too fast. Wait a moment and try again.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find that. It may have been removed or you may not have access.",
  VALIDATION_FAILED: "Some fields need attention.",
  INVALID_CREDENTIALS: "That email, username or password is not right.",
  INVALID_TOTP: "That code did not work. Check your authenticator app and try again.",
  ACCOUNT_BANNED: "This account has been banned.",
  ACCOUNT_DEACTIVATED: "This account has been deactivated.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first. Check your inbox for the link.",
  EMAIL_TAKEN: "An account with that email already exists.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters, not a common one.",
  REGISTRATION_CLOSED: "Sign-ups are closed right now.",
  USERNAME_RESERVED: "That username is reserved. Try another.",
  MEDIA_INVALID: "That file could not be used. Try a different one.",
  MEDIA_NOT_READY: "Your upload is still processing. Try again in a moment.",
  MEDIA_IN_USE: "That file is already attached somewhere else.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  LAST_ADMIN: "You are the last administrator. Make someone else an admin first.",
  ACCOUNT_RESTRICTED: "Your account is restricted, so you can keep learning but not post reviews or questions right now.",
  SIGN_IN_REQUIRED: "Sign in to continue.",
  COURSE_ACCESS_REQUIRED: "You need access to this course first.",
  NOT_FREE: "This course is not free. Choose a way to enroll on the course page.",
  STAFF_PREVIEW: "You are viewing as course staff, so progress is not recorded.",
  ITEM_COMPLETES_ITSELF: "This lesson completes on its own when you finish it.",
  VIDEO_NOT_READY: "This video is still processing. Try again in a few minutes.",
  VIDEO_NOT_FOUND: "This video is not available.",
  VIDEO_NOT_CONFIGURED: "Video playback is not set up on this academy yet.",
  VIDEO_SERVICE_UNAVAILABLE: "The video service is not reachable. Try again in a moment.",
  VIDEO_SERVICE_ERROR: "The video could not start. Try again in a moment.",
  NO_ATTEMPTS_LEFT: "You have used every attempt for this quiz.",
  ATTEMPT_CLOSED: "This attempt has already been submitted.",
  ATTEMPT_OVERDUE: "Time is up for this attempt.",
  SUBMISSION_PENDING: "Your last submission is still waiting for review.",
  ALREADY_APPROVED: "This assignment is already approved.",
  PAST_DUE: "The due date has passed and late submissions are not accepted.",
  ALREADY_REVIEWED: "Someone already reviewed this submission.",
  BELOW_PASS_MARK: "The score is below the pass mark, so it cannot be approved.",
  CERTIFICATE_RENDERING: "Your certificate is being prepared. Try again in a minute.",
  PREVIEW: "This is a free preview. Enroll to keep your progress.",
  AT_SECONDS_VIDEO_ONLY: "Only notes on a video can be pinned to a time.",
  SUBMISSION_EMPTY: "Add some work before submitting: text, a link or a file.",
  NO_SUBMISSION_TYPE: "This assignment is not accepting submissions yet.",
  ATTEMPT_CONFLICT: "This quiz changed in another tab. Reload to continue.",
  QUIZ_EMPTY: "This quiz has no questions yet.",
  NOTHING_TO_RESUME: "There is nothing to resume yet. Start from the first lesson.",
  ITEM_NOT_FOUND: "This lesson is not available. It may have been removed.",
  ENROLLMENT_NOT_ACTIVE: "Your access to this course has ended.",
  NOT_ENROLLED: "Enroll in this course first.",
  TOO_EARLY: "Learn a little more of the course before reviewing it.",
  CANNOT_REPORT_OWN: "You cannot report your own post.",
  CERTIFICATE_REVOKED: "This certificate has been revoked.",
  CERTIFICATE_NOT_FOUND: "We could not find a certificate with that number.",
  COUPON_INVALID: "That coupon cannot be used for this purchase.",
  CHECKOUT_IN_PROGRESS: "Another checkout is already open. Finish or close it, then try again.",
  CHECKOUT_CLOSED: "This checkout has closed. Start again.",
  CHECKOUT_EXPIRED: "This checkout timed out. Start again.",
  CHECKOUT_FAILED: "This order could not be completed. You were not charged.",
  CURRENCY_NOT_PAYABLE: "Payments in this currency are not available right now. Choose another currency.",
  CURRENCY_NOT_SUPPORTED: "Payments in this currency are not accepted here. Choose another currency.",
  PRICE_NOT_AVAILABLE: "This is not sold in that currency. Choose another currency.",
  NOT_FOR_SALE: "This is not for sale. Open its page to see how to get it.",
  INTERVAL_REQUIRED: "Choose monthly or yearly billing.",
  PAYMENT_NOT_VERIFIED: "We could not verify that payment. If you were charged, it will be refunded or applied automatically.",
  INVOICE_RENDERING: "Your invoice is being prepared. Try again in a minute.",
  ALREADY_OWNED: "You already have access to everything in this order.",
  SUBSCRIPTION_EXISTS: "You already have a subscription. Manage it from your account.",
  SUBSCRIPTION_ACTIVE: "Cancel your subscription before deleting your account.",
  CURRENCY_NOT_OFFERED: "That currency is not offered.",
  PAYMENT_NOT_CONFIGURED: "Payments are not set up for this currency yet.",
  ORDER_NOT_PENDING: "This order is no longer awaiting payment.",
  REFUND_EXCEEDS: "That is more than the amount left to refund.",
  NOT_REFUNDABLE: "This order can not be refunded. Only paid orders with money left to refund can.",
  GATEWAY_ERROR: "The payment provider did not accept the request. Try again, or check the provider's dashboard.",
  FORBIDDEN_ROLE: "Only finance staff and administrators can do that.",
  SUBSCRIPTION_NOT_ACTIVE: "This subscription is no longer active. Refresh to see its current status.",
  DUPLICATE_PRICE: "Use one price per currency and billing interval.",
  BUNDLE_EMPTY: "Add at least one course before making the bundle active.",
  UNKNOWN_COURSE: "One of the courses no longer exists. Remove it and save again.",
  UNKNOWN_TARGET: "One of the picked items no longer exists. Remove it and save again.",
  SLUG_TAKEN: "That slug is taken. Try another.",
  COUPON_CODE_TAKEN: "A coupon with that code already exists. Pick another code.",
  BELOW_REDEMPTIONS: "The limit can not be lower than the number of times it has already been used.",
  RANGE_TOO_LARGE: "Export at most 400 days at a time.",
  PUBLISH_BLOCKED: "Finish the checklist before publishing.",
  COURSE_IN_USE: "Learners are enrolled in this course, so it can be archived but not deleted.",
  PRICE_ZERO: "Set a price above zero, or make the course free.",
  NOT_STAFF_ROLE: "Only instructors and staff can be added to a course team.",
  AI_UNAVAILABLE: "AI assistance is not set up on this academy.",
  URL_INVALID: "Enter a valid http or https link.",
  SELF_ACTION: "You cannot do this to your own account.",
  TARGET_PROTECTED: "This account belongs to a staff member at or above your role. Ask an administrator.",
  ALREADY_ERASED: "This account was already erased.",
  CANNOT_CHANGE_OWN_ROLE: "You cannot change your own role. Ask another administrator.",
  USER_INACTIVE: "Banned or erased accounts cannot be given a staff role.",
  INVALID_STATUS: "The account is no longer in that state. Refresh to see its current status.",
  ENROLLMENT_SUBSCRIPTION: "Access through a subscription ends with the subscription, so it cannot be changed here.",
  VALID_UNTIL_PAST: "Pick an end date in the future.",
  CERTIFICATE_NOT_REVOKED: "This certificate is not revoked.",
  RANGE_INVALID: "Pick a start date on or before the end date.",
  RANGE_TOO_LONG: "A range can be at most 366 days.",
  FORBIDDEN_AREA: "Your role does not include this area.",
  CURRENCY_NOT_ENABLED: "Enable that currency first.",
  CERTIFICATE_NAME_INVALID: "Use your name as it should appear on certificates.",
  // Authoring, grading, moderation (admin authoring build)
  INVALID_SLUG: "Use lowercase letters, digits and single hyphens in the address.",
  COURSE_CREATE_FORBIDDEN: "Only instructors and administrators can create courses.",
  COURSE_ROLE_REQUIRED: "Only the course owner or an administrator can do that.",
  OWNER_REQUIRED: "A course needs at least one owner.",
  DUPLICATE_STAFF: "Someone is on the team twice. Remove the duplicate.",
  COMPARE_AT_TOO_LOW: "The compare-at price must be above the price.",
  DUPLICATE_CURRENCY: "Each currency can have one price.",
  SUBSCRIPTION_ONLY_INCLUDED: "Subscription-only courses are always included in the subscription.",
  PREVIEW_LECTURES_ONLY: "Only lectures can be free previews.",
  TOO_MANY_SECTIONS: "This course has the most sections it can hold.",
  TOO_MANY_ITEMS: "This section has the most items it can hold.",
  TOO_MANY_RESOURCES: "This lecture has the most resources it can hold.",
  TOO_MANY_CATEGORIES: "Pick up to 10 categories.",
  RESOURCE_SOURCE: "Attach a file or a link, not both.",
  INVALID_URL: "Use an https:// link.",
  DRAW_COUNT_REQUIRED: "Say how many questions a random quiz draws.",
  NOT_FIXED_QUIZ: "Only fixed quizzes have a question list. Switch the quiz to a fixed list first.",
  INVALID_RUBRIC: "Check the rubric: every criterion needs a name and points.",
  PASS_POINTS_TOO_HIGH: "The pass mark is above what the rubric can award.",
  REORDER_MISMATCH: "The list changed while you were reordering it. Reload and try again.",
  ALREADY_RESOLVED: "Someone already resolved this report.",
  AI_FAILED: "The AI could not finish that. Try again, or do it by hand.",
};

export function errorCopy(code: string | undefined, fallback?: string): string {
  if (code && COPY[code]) return COPY[code];
  return fallback || "Something went wrong. Try again.";
}

/** The best human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    // Validation messages from the server are already field-specific and readable.
    if (e.code === "VALIDATION_FAILED") {
      const first = Object.values(e.fieldErrors)[0];
      return first ? `${COPY.VALIDATION_FAILED} ${capitalise(first)}.` : COPY.VALIDATION_FAILED!;
    }
    return errorCopy(e.code, e.message);
  }
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  return errorCopy(undefined);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");

/** Errors not worth a toast: the page already shows them in place. */
export function isQuietError(e: unknown): boolean {
  if (isApiError(e)) return e.status === 404 || e.status === 401 || e.code === "VALIDATION_FAILED";
  return e instanceof Error && e.name === "AbortError";
}
