# Test ids

Stable `data-testid` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. `<id>` marks a dynamic suffix (for example `case-action-<id>` is `case-action-hide`).

Generated from the source by `node scripts/gen-testids.mjs`; rerun it after adding or renaming an id.

## Shell and navigation

| Test id | Source |
|---|---|
| `avatar-menu` | `components/shell/avatar-menu.tsx` |
| `confirm-action` | `components/common/confirm-dialog.tsx` |
| `header-search` | `components/shell/header.tsx` |
| `nav-<id>` | `components/shell/header.tsx` |
| `nav-admin` | `components/shell/avatar-menu.tsx` |
| `notifications-bell` | `components/shell/notifications-bell.tsx` |
| `notifications-dropdown` | `components/shell/notifications-bell.tsx` |
| `restriction-banner` | `components/shell/restriction-banner.tsx` |
| `sign-out` | `components/shell/avatar-menu.tsx` |
| `theme-dark` | `components/shell/avatar-menu.tsx` |
| `theme-light` | `components/shell/avatar-menu.tsx` |
| `theme-system` | `components/shell/avatar-menu.tsx` |

## Home

| Test id | Source |
|---|---|
| `continue-learning` | `components/home/home-page.tsx` |
| `home-browse` | `components/home/home-page.tsx` |
| `home-categories` | `components/home/home-page.tsx` |
| `home-how` | `components/home/home-page.tsx` |
| `home-plans` | `components/home/home-page.tsx` |
| `home-search` | `components/home/home-page.tsx` |
| `resume-card` | `components/home/home-page.tsx` |

## Sign up and sign in

| Test id | Source |
|---|---|
| `forgot-sent` | `components/auth/forgot-password.tsx` |
| `forgot-submit` | `components/auth/forgot-password.tsx` |
| `goodbye` | `components/auth/goodbye.tsx` |
| `login-submit` | `components/auth/login-form.tsx` |
| `recovery-code-input` | `components/auth/login-form.tsx` |
| `recovery-toggle` | `components/auth/login-form.tsx` |
| `reset-done` | `components/auth/reset-password.tsx` |
| `reset-submit` | `components/auth/reset-password.tsx` |
| `signup-check-email` | `components/auth/signup-form.tsx` |
| `signup-submit` | `components/auth/signup-form.tsx` |
| `totp-input` | `components/auth/login-form.tsx` |

## Catalog

| Test id | Source |
|---|---|
| `bundle-buy` | `components/catalog/bundles.tsx` |
| `bundle-card` | `components/catalog/bundles.tsx` |
| `bundle-title` | `components/catalog/bundles.tsx` |
| `catalog-count` | `components/catalog/catalog-page.tsx` |
| `catalog-more` | `components/catalog/catalog-page.tsx` |
| `catalog-search` | `components/catalog/catalog-page.tsx` |
| `catalog-sort` | `components/catalog/catalog-page.tsx` |
| `currency-<id>` | `components/catalog/currency-menu.tsx` |
| `currency-menu` | `components/catalog/currency-menu.tsx` |
| `filters-clear` | `components/catalog/catalog-page.tsx` |
| `filters-done` | `components/catalog/catalog-page.tsx` |
| `filters-open` | `components/catalog/catalog-page.tsx` |

## Course page

| Test id | Source |
|---|---|
| `course-bundle` | `components/course/purchase-card.tsx` |
| `course-card` | `components/course/course-card.tsx` |
| `course-instructor` | `components/course/course-page.tsx` |
| `course-outcomes` | `components/course/course-page.tsx` |
| `course-save` | `components/course/purchase-card.tsx` |
| `course-save-toggle` | `components/course/course-card.tsx` |
| `course-title` | `components/course/course-page.tsx` |
| `cta-note` | `components/course/purchase-card.tsx` |
| `cta-secondary` | `components/course/purchase-card.tsx` |
| `curriculum` | `components/course/curriculum.tsx` |
| `curriculum-expand` | `components/course/curriculum.tsx` |
| `curriculum-preview` | `components/course/curriculum.tsx` |
| `curriculum-section` | `components/course/curriculum.tsx` |
| `instructor-name` | `components/instructor/instructor-page.tsx` |
| `preview-dialog` | `components/course/preview-dialog.tsx` |
| `purchase-bar` | `components/course/purchase-card.tsx` |
| `purchase-card` | `components/course/purchase-card.tsx` |
| `review` | `components/course/course-reviews.tsx` |
| `review-report` | `components/course/course-reviews.tsx` |
| `reviews-list` | `components/course/course-reviews.tsx` |
| `reviews-more` | `components/course/course-reviews.tsx` |
| `staff-banner` | `components/course/course-page.tsx` |

## Video player

| Test id | Source |
|---|---|
| `player-big-play` | `components/player/video-player.tsx` |
| `video-player` | `components/player/video-player.tsx`, `components/player/youtube-frame.tsx` |

## Classroom

| Test id | Source |
|---|---|
| `assignment` | `components/classroom/assignment-panel.tsx` |
| `assignment-body` | `components/classroom/assignment-panel.tsx` |
| `assignment-closed` | `components/classroom/assignment-panel.tsx` |
| `assignment-composer` | `components/classroom/assignment-panel.tsx` |
| `assignment-file-input` | `components/classroom/assignment-panel.tsx` |
| `assignment-rubric` | `components/classroom/assignment-panel.tsx` |
| `assignment-submit` | `components/classroom/assignment-panel.tsx` |
| `assignment-url` | `components/classroom/assignment-panel.tsx` |
| `classroom-autoplay` | `components/classroom/lecture-video.tsx` |
| `classroom-back` | `components/classroom/classroom-shell.tsx` |
| `classroom-certificate` | `components/classroom/classroom-shell.tsx` |
| `classroom-certificate-link` | `components/classroom/completion.tsx` |
| `classroom-complete-banner` | `components/classroom/completion.tsx` |
| `classroom-curriculum` | `components/classroom/curriculum-panel.tsx` |
| `classroom-item` | `components/classroom/item-view.tsx` |
| `classroom-item-title` | `components/classroom/item-view.tsx` |
| `classroom-main` | `components/classroom/classroom-shell.tsx` |
| `classroom-next` | `components/classroom/item-view.tsx` |
| `classroom-notes` | `components/classroom/notes-panel.tsx` |
| `classroom-open-curriculum` | `components/classroom/classroom-shell.tsx` |
| `classroom-overview` | `components/classroom/classroom-index.tsx` |
| `classroom-overview-tab` | `components/classroom/overview-panel.tsx` |
| `classroom-prev` | `components/classroom/item-view.tsx` |
| `classroom-progress` | `components/classroom/classroom-shell.tsx` |
| `classroom-qa` | `components/classroom/qa-panel.tsx` |
| `classroom-resource` | `components/classroom/resources-panel.tsx` |
| `classroom-resources` | `components/classroom/resources-panel.tsx` |
| `classroom-start` | `components/classroom/classroom-index.tsx` |
| `classroom-theme` | `components/classroom/classroom-shell.tsx` |
| `classroom-topbar` | `components/classroom/classroom-shell.tsx` |
| `classroom-up-next` | `components/classroom/lecture-video.tsx` |
| `curriculum-bookmark` | `components/classroom/curriculum-panel.tsx` |
| `curriculum-item` | `components/classroom/curriculum-panel.tsx` |
| `curriculum-section` | `components/classroom/curriculum-panel.tsx` |
| `lesson-article` | `components/classroom/lecture-doc.tsx` |
| `lesson-completed` | `components/classroom/lecture-doc.tsx` |
| `lesson-mark-done` | `components/classroom/lecture-doc.tsx` |
| `lesson-pdf` | `components/classroom/lecture-doc.tsx` |
| `lesson-pdf-download` | `components/classroom/lecture-doc.tsx` |
| `note-add` | `components/classroom/notes-panel.tsx` |
| `note-body` | `components/classroom/notes-panel.tsx` |
| `note-menu` | `components/classroom/notes-panel.tsx` |
| `note-row` | `components/classroom/notes-panel.tsx` |
| `note-seek` | `components/classroom/notes-panel.tsx` |
| `qa-accept` | `components/classroom/qa-panel.tsx` |
| `qa-accepted` | `components/classroom/qa-panel.tsx` |
| `qa-ask` | `components/classroom/qa-panel.tsx` |
| `qa-ask-form` | `components/classroom/qa-panel.tsx` |
| `qa-post` | `components/classroom/qa-panel.tsx` |
| `qa-post-menu` | `components/classroom/qa-panel.tsx` |
| `qa-reply` | `components/classroom/qa-panel.tsx` |
| `qa-reply-body` | `components/classroom/qa-panel.tsx` |
| `qa-reply-send` | `components/classroom/qa-panel.tsx` |
| `qa-search` | `components/classroom/qa-panel.tsx` |
| `qa-thread` | `components/classroom/qa-panel.tsx` |
| `qa-thread-row` | `components/classroom/qa-panel.tsx` |
| `quiz-attempt-row` | `components/classroom/quiz-runner.tsx` |
| `quiz-flag` | `components/classroom/quiz-runner.tsx` |
| `quiz-next` | `components/classroom/quiz-runner.tsx` |
| `quiz-no-attempts` | `components/classroom/quiz-runner.tsx` |
| `quiz-option` | `components/classroom/quiz-runner.tsx` |
| `quiz-overview` | `components/classroom/quiz-runner.tsx` |
| `quiz-palette` | `components/classroom/quiz-runner.tsx` |
| `quiz-question` | `components/classroom/quiz-runner.tsx` |
| `quiz-result` | `components/classroom/quiz-runner.tsx` |
| `quiz-result-status` | `components/classroom/quiz-runner.tsx` |
| `quiz-resume` | `components/classroom/quiz-runner.tsx` |
| `quiz-retake` | `components/classroom/quiz-runner.tsx` |
| `quiz-review` | `components/classroom/quiz-runner.tsx` |
| `quiz-runner` | `components/classroom/quiz-runner.tsx` |
| `quiz-start` | `components/classroom/quiz-runner.tsx` |
| `quiz-submit` | `components/classroom/quiz-runner.tsx` |
| `quiz-text-answer` | `components/classroom/quiz-runner.tsx` |
| `quiz-timer` | `components/classroom/quiz-runner.tsx` |
| `report-dialog` | `components/classroom/qa-panel.tsx` |
| `report-submit` | `components/classroom/qa-panel.tsx` |
| `review-body` | `components/classroom/overview-panel.tsx` |
| `review-mine` | `components/classroom/overview-panel.tsx` |
| `review-prompt` | `components/classroom/overview-panel.tsx` |
| `review-save` | `components/classroom/overview-panel.tsx` |
| `review-star-<id>` | `components/classroom/overview-panel.tsx` |
| `submission-row` | `components/classroom/assignment-panel.tsx` |
| `up-next-cancel` | `components/classroom/lecture-video.tsx` |
| `up-next-play` | `components/classroom/lecture-video.tsx` |

## My learning

| Test id | Source |
|---|---|
| `certificate-download` | `components/my-learning/my-learning-page.tsx` |
| `certificate-row` | `components/my-learning/my-learning-page.tsx` |
| `learning-entry` | `components/my-learning/my-learning-page.tsx` |
| `learning-lapsed` | `components/my-learning/my-learning-page.tsx` |
| `learning-resume` | `components/my-learning/my-learning-page.tsx` |
| `my-bookmarks` | `components/my-learning/my-learning-page.tsx` |
| `my-certificates` | `components/my-learning/my-learning-page.tsx` |
| `my-learning-list` | `components/my-learning/my-learning-page.tsx` |
| `my-learning-summary` | `components/my-learning/my-learning-page.tsx` |

## Certificates

| Test id | Source |
|---|---|
| `certificate` | `components/verify/verify.tsx` |
| `certificate-download` | `components/verify/verify.tsx` |
| `certificate-learner` | `components/verify/verify.tsx` |
| `verify-serial` | `components/verify/verify.tsx` |
| `verify-status` | `components/verify/verify.tsx` |
| `verify-submit` | `components/verify/verify.tsx` |

## Plans and checkout

| Test id | Source |
|---|---|
| `billing-country` | `components/checkout/checkout-page.tsx` |
| `billing-name` | `components/checkout/checkout-page.tsx` |
| `billing-tax-id` | `components/checkout/checkout-page.tsx` |
| `checkout-currency` | `components/checkout/checkout-page.tsx` |
| `checkout-dismissed` | `components/checkout/checkout-page.tsx` |
| `checkout-failed` | `components/checkout/checkout-page.tsx` |
| `checkout-gateway` | `components/checkout/checkout-page.tsx` |
| `checkout-pay` | `components/checkout/checkout-page.tsx` |
| `checkout-problem-<id>` | `components/checkout/checkout-page.tsx` |
| `coupon-applied` | `components/checkout/order-summary.tsx` |
| `coupon-apply` | `components/checkout/order-summary.tsx` |
| `coupon-error` | `components/checkout/order-summary.tsx` |
| `coupon-input` | `components/checkout/order-summary.tsx` |
| `coupon-open` | `components/checkout/order-summary.tsx` |
| `coupon-remove` | `components/checkout/order-summary.tsx` |
| `order-continue` | `components/checkout/order-status-page.tsx` |
| `order-invoice` | `components/checkout/order-status-page.tsx` |
| `order-paid` | `components/checkout/order-status-page.tsx` |
| `order-pending` | `components/checkout/order-status-page.tsx` |
| `order-summary` | `components/checkout/order-summary.tsx` |
| `plan-<id>` | `components/plans/plans-page.tsx` |
| `plan-cta` | `components/plans/plans-page.tsx` |
| `plan-manage` | `components/plans/plans-page.tsx` |
| `plan-yearly-note` | `components/plans/plans-page.tsx` |
| `plans-current` | `components/plans/plans-page.tsx` |
| `plans-list` | `components/plans/plans-page.tsx` |
| `plans-manage` | `components/plans/plans-page.tsx` |
| `summary-recurring` | `components/checkout/order-summary.tsx` |
| `summary-title` | `components/checkout/order-summary.tsx` |
| `summary-total` | `components/checkout/order-summary.tsx` |

## Account center

| Test id | Source |
|---|---|
| `account-nav-<id>` | `components/account/account-shell.tsx` |
| `account-nav-select` | `components/account/account-shell.tsx` |
| `avatar-upload` | `components/account/profile-section.tsx` |
| `certificate-preview` | `components/account/profile-section.tsx` |
| `delete-account` | `components/account/privacy-section.tsx` |
| `delete-account-confirm` | `components/account/privacy-section.tsx` |
| `delete-account-dialog` | `components/account/privacy-section.tsx` |
| `delete-confirm-username` | `components/account/privacy-section.tsx` |
| `delete-password` | `components/account/privacy-section.tsx` |
| `delete-totp` | `components/account/privacy-section.tsx` |
| `deletion-pending` | `components/account/account-shell.tsx` |
| `email-pref-<id>` | `components/account/notifications-section.tsx` |
| `export-data` | `components/account/privacy-section.tsx` |
| `order-detail` | `components/account/order-detail-section.tsx` |
| `order-detail-credit-note` | `components/account/order-detail-section.tsx` |
| `order-detail-invoice` | `components/account/order-detail-section.tsx` |
| `order-invoice-download` | `components/account/orders-section.tsx` |
| `order-row` | `components/account/orders-section.tsx` |
| `orders-list` | `components/account/orders-section.tsx` |
| `password-save` | `components/account/security-section.tsx` |
| `profile-bio` | `components/account/profile-section.tsx` |
| `profile-certificate-name` | `components/account/profile-section.tsx` |
| `profile-currency` | `components/account/profile-section.tsx` |
| `profile-display-name` | `components/account/profile-section.tsx` |
| `profile-headline` | `components/account/profile-section.tsx` |
| `profile-save` | `components/account/profile-section.tsx` |
| `profile-website` | `components/account/profile-section.tsx` |
| `recovery-codes` | `components/account/security-section.tsx` |
| `recovery-copy` | `components/account/security-section.tsx` |
| `recovery-done` | `components/account/security-section.tsx` |
| `recovery-download` | `components/account/security-section.tsx` |
| `recovery-saved` | `components/account/security-section.tsx` |
| `session-revoke` | `components/account/security-section.tsx` |
| `sessions-list` | `components/account/security-section.tsx` |
| `sessions-sign-out-all` | `components/account/security-section.tsx` |
| `subscription-cancel` | `components/account/subscription-section.tsx` |
| `subscription-date` | `components/account/subscription-section.tsx` |
| `subscription-resume` | `components/account/subscription-section.tsx` |
| `subscription-status` | `components/account/subscription-section.tsx` |
| `subscription-warning` | `components/account/subscription-section.tsx` |
| `totp-disable` | `components/account/security-section.tsx` |
| `totp-enable` | `components/account/security-section.tsx` |
| `totp-qr` | `components/account/security-section.tsx` |
| `totp-regenerate` | `components/account/security-section.tsx` |
| `totp-secret` | `components/account/security-section.tsx` |
| `totp-start` | `components/account/security-section.tsx` |

## Notifications

| Test id | Source |
|---|---|
| `notification-item` | `components/notifications/notification-item.tsx` |

## Admin

| Test id | Source |
|---|---|
| `add-staff-<id>` | `components/admin/ops/staff.tsx` |
| `add-staff-dialog` | `components/admin/ops/staff.tsx` |
| `add-staff-next` | `components/admin/ops/staff.tsx` |
| `add-staff-role` | `components/admin/ops/staff.tsx` |
| `admin-academy-name` | `components/admin/shell/admin-shell.tsx` |
| `admin-forbidden` | `components/admin/shell/forbidden.tsx` |
| `admin-invoice-download` | `components/admin/commerce/order-detail.tsx` |
| `admin-menu` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav-<id>` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar-toggle` | `components/admin/shell/admin-shell.tsx` |
| `admin-view-site` | `components/admin/shell/admin-shell.tsx` |
| `ai-accept-all` | `components/admin/courses/questions-tab.tsx` |
| `ai-apply` | `components/admin/grading/grading-detail.tsx` |
| `ai-count` | `components/admin/courses/questions-tab.tsx` |
| `ai-draft-<id>` | `components/admin/courses/questions-tab.tsx` |
| `ai-draft-accept` | `components/admin/courses/questions-tab.tsx` |
| `ai-draft-skip` | `components/admin/courses/questions-tab.tsx` |
| `ai-drafts` | `components/admin/courses/questions-tab.tsx` |
| `ai-generate` | `components/admin/courses/questions-tab.tsx` |
| `ai-item` | `components/admin/courses/questions-tab.tsx` |
| `ai-kind-<id>` | `components/admin/courses/questions-tab.tsx` |
| `ai-questions-dialog` | `components/admin/courses/questions-tab.tsx` |
| `ai-request` | `components/admin/grading/grading-detail.tsx` |
| `ai-source-<id>` | `components/admin/courses/questions-tab.tsx` |
| `ai-suggestion` | `components/admin/grading/grading-detail.tsx` |
| `ai-text` | `components/admin/courses/questions-tab.tsx` |
| `answer-<id>` | `components/admin/courses/questions-tab.tsx` |
| `answer-add` | `components/admin/courses/questions-tab.tsx` |
| `article-body` | `components/admin/courses/item-editor.tsx` |
| `article-preview` | `components/admin/courses/item-editor.tsx` |
| `assignment-<id>` | `components/admin/courses/item-editor.tsx` |
| `assignment-allow-late` | `components/admin/courses/item-editor.tsx` |
| `audit-data` | `components/admin/ops/audit.tsx` |
| `audit-expand` | `components/admin/ops/audit.tsx` |
| `audit-list` | `components/admin/ops/audit.tsx` |
| `audit-row-<id>` | `components/admin/ops/audit.tsx` |
| `bank-option-<id>` | `components/admin/courses/item-editor.tsx` |
| `bank-picker` | `components/admin/courses/item-editor.tsx` |
| `bundle-course-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-course-add-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-cover-input` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-cover-upload` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-description` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-form` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-price-amount-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-price-compare-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-price-row-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-save` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-separately-<id>` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-slug` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-status` | `components/admin/commerce/bundle-sheet.tsx` |
| `bundle-title` | `components/admin/commerce/bundle-sheet.tsx` |
| `categories-list` | `components/admin/categories/categories-page.tsx` |
| `category-<id>` | `components/admin/categories/categories-page.tsx` |
| `category-delete` | `components/admin/categories/categories-page.tsx` |
| `category-description` | `components/admin/categories/categories-page.tsx` |
| `category-dialog` | `components/admin/categories/categories-page.tsx` |
| `category-edit` | `components/admin/categories/categories-page.tsx` |
| `category-handle` | `components/admin/categories/categories-page.tsx` |
| `category-name` | `components/admin/categories/categories-page.tsx` |
| `category-new` | `components/admin/categories/categories-page.tsx` |
| `category-option-<id>` | `components/admin/courses/details-tab.tsx` |
| `category-save` | `components/admin/categories/categories-page.tsx` |
| `category-slug` | `components/admin/categories/categories-page.tsx` |
| `cert-restore` | `components/admin/ops/certificates.tsx` |
| `cert-revoke` | `components/admin/ops/certificates.tsx` |
| `cert-verify-<id>` | `components/admin/ops/certificates.tsx` |
| `check-<id>` | `components/admin/courses/publish-panel.tsx` |
| `coupon-active` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-active-<id>` | `components/admin/commerce/coupons-page.tsx` |
| `coupon-amount` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-code` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-currency` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-description` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-expires` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-form` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-generate` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-kind` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-max` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-new` | `components/admin/commerce/coupons-page.tsx` |
| `coupon-per-user` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-percent` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-save` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-scope` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-starts` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-target-add-<id>` | `components/admin/commerce/coupon-sheet.tsx` |
| `coupon-targets` | `components/admin/commerce/coupon-sheet.tsx` |
| `course-<id>` | `components/admin/courses/details-tab.tsx` |
| `course-access` | `components/admin/courses/details-tab.tsx` |
| `course-archive` | `components/admin/courses/publish-panel.tsx` |
| `course-categories` | `components/admin/courses/details-tab.tsx` |
| `course-delete` | `components/admin/courses/publish-panel.tsx` |
| `course-details` | `components/admin/courses/details-tab.tsx` |
| `course-language` | `components/admin/courses/details-tab.tsx` |
| `course-level` | `components/admin/courses/details-tab.tsx` |
| `course-new` | `components/admin/courses/courses-page.tsx` |
| `course-pricing` | `components/admin/courses/pricing-tab.tsx` |
| `course-publish` | `components/admin/courses/publish-panel.tsx` |
| `course-save` | `components/admin/courses/details-tab.tsx` |
| `course-slug` | `components/admin/courses/details-tab.tsx` |
| `course-staff` | `components/admin/courses/staff-tab.tsx` |
| `course-status` | `components/admin/courses/course-bits.tsx` |
| `course-subtitle` | `components/admin/courses/details-tab.tsx` |
| `course-title` | `components/admin/courses/details-tab.tsx` |
| `course-unpublish` | `components/admin/courses/publish-panel.tsx` |
| `cover-input` | `components/admin/courses/details-tab.tsx` |
| `cover-remove` | `components/admin/courses/details-tab.tsx` |
| `cover-upload` | `components/admin/courses/details-tab.tsx` |
| `curriculum-builder` | `components/admin/courses/curriculum-builder.tsx` |
| `decide-approve` | `components/admin/grading/grading-detail.tsx` |
| `decide-changes` | `components/admin/grading/grading-detail.tsx` |
| `decide-reject` | `components/admin/grading/grading-detail.tsx` |
| `decision-problem` | `components/admin/grading/grading-detail.tsx` |
| `details-save-bar` | `components/admin/courses/details-tab.tsx` |
| `enrollment-<id>` | `components/admin/ops/learners.tsx` |
| `enrollment-extend` | `components/admin/ops/learners.tsx` |
| `enrollment-revoke` | `components/admin/ops/learners.tsx` |
| `evs-choose` | `components/admin/courses/item-editor.tsx` |
| `evs-picker` | `components/admin/courses/evs-picker.tsx` |
| `evs-video-<id>` | `components/admin/courses/evs-picker.tsx` |
| `extend-date` | `components/admin/ops/learners.tsx` |
| `extend-dialog` | `components/admin/ops/learners.tsx` |
| `extend-lifetime` | `components/admin/ops/learners.tsx` |
| `extend-save` | `components/admin/ops/learners.tsx` |
| `fix-<id>` | `components/admin/courses/publish-panel.tsx` |
| `grading-course` | `components/admin/grading/grading-queue.tsx` |
| `grading-next` | `components/admin/grading/grading-detail.tsx` |
| `grant-confirm` | `components/admin/ops/learners.tsx` |
| `grant-course-<id>` | `components/admin/ops/learners.tsx` |
| `grant-dialog` | `components/admin/ops/learners.tsx` |
| `grant-note` | `components/admin/ops/learners.tsx` |
| `grant-until` | `components/admin/ops/learners.tsx` |
| `inline-rename` | `components/admin/courses/curriculum-builder.tsx` |
| `integration-<id>` | `components/admin/ops/settings.tsx` |
| `item-<id>` | `components/admin/courses/curriculum-builder.tsx` |
| `item-add` | `components/admin/courses/curriculum-builder.tsx` |
| `item-add-<id>` | `components/admin/courses/curriculum-builder.tsx` |
| `item-delete` | `components/admin/courses/curriculum-builder.tsx` |
| `item-editor-delete` | `components/admin/courses/item-editor.tsx` |
| `item-handle` | `components/admin/courses/curriculum-builder.tsx` |
| `item-minutes` | `components/admin/courses/item-editor.tsx` |
| `item-open` | `components/admin/courses/curriculum-builder.tsx` |
| `item-preview` | `components/admin/courses/item-editor.tsx` |
| `item-preview-toggle` | `components/admin/courses/curriculum-builder.tsx` |
| `item-rename` | `components/admin/courses/curriculum-builder.tsx` |
| `item-save` | `components/admin/courses/item-editor.tsx` |
| `item-seconds` | `components/admin/courses/item-editor.tsx` |
| `item-title` | `components/admin/courses/item-editor.tsx` |
| `learner-ban` | `components/admin/ops/learners.tsx` |
| `learner-erase` | `components/admin/ops/learners.tsx` |
| `learner-grant` | `components/admin/ops/learners.tsx` |
| `learner-suspend` | `components/admin/ops/learners.tsx` |
| `learner-unban` | `components/admin/ops/learners.tsx` |
| `learner-unsuspend` | `components/admin/ops/learners.tsx` |
| `new-course-create` | `components/admin/courses/courses-page.tsx` |
| `new-course-dialog` | `components/admin/courses/courses-page.tsx` |
| `new-course-title` | `components/admin/courses/courses-page.tsx` |
| `option-add` | `components/admin/courses/questions-tab.tsx` |
| `option-correct-<id>` | `components/admin/courses/questions-tab.tsx` |
| `option-text-<id>` | `components/admin/courses/questions-tab.tsx` |
| `order-events-list` | `components/admin/commerce/order-detail.tsx` |
| `order-lines` | `components/admin/commerce/order-detail.tsx` |
| `order-link-<id>` | `components/admin/commerce/orders-page.tsx` |
| `order-readonly` | `components/admin/commerce/order-detail.tsx` |
| `order-refund` | `components/admin/commerce/order-detail.tsx` |
| `order-refund-list` | `components/admin/commerce/order-detail.tsx` |
| `orders-export` | `components/admin/commerce/orders-page.tsx` |
| `orders-export-confirm` | `components/admin/commerce/orders-page.tsx` |
| `orders-export-dialog` | `components/admin/commerce/orders-page.tsx` |
| `orders-export-from` | `components/admin/commerce/orders-page.tsx` |
| `orders-export-to` | `components/admin/commerce/orders-page.tsx` |
| `orders-gateway` | `components/admin/commerce/orders-page.tsx` |
| `overview-export` | `components/admin/ops/overview.tsx` |
| `pdf-input` | `components/admin/courses/item-editor.tsx` |
| `pdf-upload` | `components/admin/courses/item-editor.tsx` |
| `plan-description` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-feature-<id>` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-feature-add` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-form` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-name` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-position` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-price-add` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-price-amount` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-price-currency` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-price-interval` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-price-row-<id>-<id>` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-save` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-slug` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-status` | `components/admin/commerce/plan-sheet.tsx` |
| `plan-trial` | `components/admin/commerce/plan-sheet.tsx` |
| `polish-<id>` | `components/admin/courses/details-tab.tsx` |
| `price-amount-<id>` | `components/admin/courses/pricing-tab.tsx` |
| `price-compare-<id>` | `components/admin/courses/pricing-tab.tsx` |
| `price-row-<id>` | `components/admin/courses/pricing-tab.tsx` |
| `prices-save` | `components/admin/courses/pricing-tab.tsx` |
| `publish-checklist` | `components/admin/courses/publish-panel.tsx` |
| `publish-panel` | `components/admin/courses/publish-panel.tsx` |
| `publish-ready` | `components/admin/courses/publish-panel.tsx` |
| `question-bank` | `components/admin/courses/questions-tab.tsx` |
| `question-delete` | `components/admin/courses/questions-tab.tsx` |
| `question-dialog` | `components/admin/courses/questions-tab.tsx` |
| `question-explanation` | `components/admin/courses/questions-tab.tsx` |
| `question-kind` | `components/admin/courses/questions-tab.tsx` |
| `question-match` | `components/admin/courses/questions-tab.tsx` |
| `question-new` | `components/admin/courses/questions-tab.tsx` |
| `question-points` | `components/admin/courses/questions-tab.tsx` |
| `question-prompt` | `components/admin/courses/questions-tab.tsx` |
| `question-save` | `components/admin/courses/questions-tab.tsx` |
| `question-tags` | `components/admin/courses/questions-tab.tsx` |
| `questions-ai` | `components/admin/courses/questions-tab.tsx` |
| `questions-tag-clear` | `components/admin/courses/questions-tab.tsx` |
| `quiz-add-questions` | `components/admin/courses/item-editor.tsx` |
| `quiz-draw-tags` | `components/admin/courses/item-editor.tsx` |
| `quiz-instructions` | `components/admin/courses/item-editor.tsx` |
| `quiz-reveal` | `components/admin/courses/item-editor.tsx` |
| `quiz-selection` | `components/admin/courses/item-editor.tsx` |
| `quiz-shuffle-options` | `components/admin/courses/item-editor.tsx` |
| `quiz-shuffle-questions` | `components/admin/courses/item-editor.tsx` |
| `range-apply` | `components/admin/ops/overview.tsx` |
| `range-from` | `components/admin/ops/overview.tsx` |
| `range-to` | `components/admin/ops/overview.tsx` |
| `read-only-note` | `components/admin/courses/course-bits.tsx` |
| `reason-confirm` | `components/admin/shell/reason-dialog.tsx` |
| `reason-days` | `components/admin/shell/reason-dialog.tsx` |
| `reason-input` | `components/admin/shell/reason-dialog.tsx` |
| `reason-typed` | `components/admin/shell/reason-dialog.tsx` |
| `refund-amount` | `components/admin/commerce/order-detail.tsx` |
| `refund-dialog` | `components/admin/commerce/order-detail.tsx` |
| `refund-error` | `components/admin/commerce/order-detail.tsx` |
| `refund-reason` | `components/admin/commerce/order-detail.tsx` |
| `refund-revoke` | `components/admin/commerce/order-detail.tsx` |
| `report-<id>` | `components/admin/moderation/moderation-page.tsx` |
| `resource-file` | `components/admin/courses/item-editor.tsx` |
| `resource-input` | `components/admin/courses/item-editor.tsx` |
| `resource-link` | `components/admin/courses/item-editor.tsx` |
| `resource-link-add` | `components/admin/courses/item-editor.tsx` |
| `resource-link-title` | `components/admin/courses/item-editor.tsx` |
| `resource-link-url` | `components/admin/courses/item-editor.tsx` |
| `resource-remove` | `components/admin/courses/item-editor.tsx` |
| `role-change-confirm` | `components/admin/ops/staff.tsx` |
| `role-change-dialog` | `components/admin/ops/staff.tsx` |
| `role-change-error` | `components/admin/ops/staff.tsx` |
| `rubric-add` | `components/admin/courses/item-editor.tsx` |
| `rubric-panel` | `components/admin/grading/grading-detail.tsx` |
| `rubric-row-<id>` | `components/admin/courses/item-editor.tsx` |
| `rubric-total` | `components/admin/courses/item-editor.tsx` |
| `score-<id>` | `components/admin/grading/grading-detail.tsx` |
| `score-total` | `components/admin/grading/grading-detail.tsx` |
| `section-<id>` | `components/admin/courses/curriculum-builder.tsx` |
| `section-add` | `components/admin/courses/curriculum-builder.tsx` |
| `section-delete` | `components/admin/courses/curriculum-builder.tsx` |
| `section-handle` | `components/admin/courses/curriculum-builder.tsx` |
| `section-menu` | `components/admin/courses/curriculum-builder.tsx` |
| `section-new-title` | `components/admin/courses/curriculum-builder.tsx` |
| `section-rename` | `components/admin/courses/curriculum-builder.tsx` |
| `settings-<id>` | `components/admin/ops/settings.tsx` |
| `settings-<id>-save` | `components/admin/ops/settings.tsx` |
| `settings-academy-name` | `components/admin/ops/settings.tsx` |
| `settings-currency-<id>` | `components/admin/ops/settings.tsx` |
| `settings-currency-list` | `components/admin/ops/settings.tsx` |
| `settings-default-currency` | `components/admin/ops/settings.tsx` |
| `settings-evs-result` | `components/admin/ops/settings.tsx` |
| `settings-gateway-<id>` | `components/admin/ops/settings.tsx` |
| `settings-integrations` | `components/admin/ops/settings.tsx` |
| `settings-logo-upload` | `components/admin/ops/settings.tsx` |
| `settings-registration` | `components/admin/ops/settings.tsx` |
| `settings-seller-name` | `components/admin/ops/settings.tsx` |
| `settings-signatory` | `components/admin/ops/settings.tsx` |
| `settings-support-email` | `components/admin/ops/settings.tsx` |
| `settings-tagline` | `components/admin/ops/settings.tsx` |
| `settings-tax-enabled` | `components/admin/ops/settings.tsx` |
| `settings-tax-rules` | `components/admin/ops/settings.tsx` |
| `settings-test-evs` | `components/admin/ops/settings.tsx` |
| `settings-timezone` | `components/admin/ops/settings.tsx` |
| `staff-<id>` | `components/admin/courses/staff-tab.tsx` |
| `staff-add` | `components/admin/ops/staff.tsx` |
| `staff-add-<id>` | `components/admin/courses/staff-tab.tsx` |
| `staff-listed` | `components/admin/courses/staff-tab.tsx` |
| `staff-remove` | `components/admin/courses/staff-tab.tsx` |
| `staff-role` | `components/admin/courses/staff-tab.tsx` |
| `staff-role-<id>` | `components/admin/ops/staff.tsx` |
| `staff-save` | `components/admin/courses/staff-tab.tsx` |
| `submission-body` | `components/admin/grading/grading-detail.tsx` |
| `submission-file` | `components/admin/grading/grading-detail.tsx` |
| `submission-url` | `components/admin/grading/grading-detail.tsx` |
| `subscription-cancel-<id>` | `components/admin/commerce/subscriptions-page.tsx` |
| `subscription-cancel-confirm` | `components/admin/commerce/subscriptions-page.tsx` |
| `subscription-cancel-dialog` | `components/admin/commerce/subscriptions-page.tsx` |
| `tax-add-rule` | `components/admin/ops/settings.tsx` |
| `tax-country-<id>` | `components/admin/ops/settings.tsx` |
| `tax-label-<id>` | `components/admin/ops/settings.tsx` |
| `tax-rate-<id>` | `components/admin/ops/settings.tsx` |
| `video-provider` | `components/admin/courses/item-editor.tsx` |
| `video-ref` | `components/admin/courses/item-editor.tsx` |
| `video-status` | `components/admin/courses/course-bits.tsx` |

## Pages

| Test id | Source |
|---|---|
| `lightbox` | `components/media/lightbox.tsx` |
