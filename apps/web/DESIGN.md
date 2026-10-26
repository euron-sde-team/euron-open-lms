# Design language

The web app follows one calm, editorial design language. It should feel like a
well-made course platform, never like a template: open sections on a cool grey ground,
type doing the work, a single teal accent. These rules are the contract for every page.

## Foundations

| Token | Use |
| --- | --- |
| `font-display` (Bricolage Grotesque, 600 to 700, tracking -0.02em) | Page titles, course titles, section headings, big numbers |
| `font-sans` (Hanken Grotesk) | Everything else. Body 15px, meta 13px, labels 12.5px |
| `ink` | Text and the one solid call to action per screen (`Button variant="primary"`: ink that turns teal on hover) |
| `primary` / `brand` | Links, focus rings, progress, the active underline, small accents. Never large fills |
| `background` / `ground-2` | Page ground and the quiet band behind a section |
| `card` + `shadow-card` + `rounded-card` (20px) | Only surfaces that float or hold a picture: course cards, the sticky purchase card, menus, dialogs, the player |
| `border` | 1px hairlines between list rows and sections |
| `star` | Rating stars only |

Widths: content `max-w-[1200px]`, reading `max-w-[720px]`, gutters `px-4 sm:px-6`. Light
and dark mode are a token swap: never hard-code a colour (`bg-white`, `#fff`, `text-gray-*`).

## Rules

1. **No box inside a box.** A card never contains another bordered or tinted panel. Lists
   inside a surface are rows separated by hairlines.
2. **Forms are not wrapped in cards.** The inputs are already boxes. A settings page is a
   column of sections: heading, one line of help, fields, a save button.
3. **Choices are words, not pills.** Tabs and filters are plain words in a row; the active
   one is ink with a 2px underline as wide as the word, the rest `muted-foreground`. Use
   `components/common/underline-tabs.tsx`.
4. **Facts are type.** "Beginner · 6 h 20 min · English" is one line of 13px meta text joined
   by middle dots, not chips. Badges (`Badge`) are only for status that changes: "Completed",
   "Refunded", "Draft".
5. **One lit action per screen.** One `primary` button; secondary actions are `outline`,
   `ghost` or a text link. Destructive actions confirm in a dialog that names the thing.
6. **Buttons are 10px-corner bars**, never capsules. Icon-only buttons are round
   (`IconButton`) and always have a label (tooltip and `aria-label`).
7. **Motion is quiet.** Cards lift 4px and their image scales to 1.03 on hover; sections rise
   14px on first view (`animate-rise`); everything respects reduced motion.
8. **Instant UI.** Optimistic updates for saves, bookmarks, notes and reorder; skeletons that
   match the final layout; never a bare spinner on a blank page. Errors say what happened and
   what to do, with the API `code` mapped in `lib/errors.ts`.
9. **No filler.** No "Welcome back!", no icon-in-a-tinted-circle feature grids, no gradient
   blobs, no stat-tile bands, no invented numbers (a count is shown only when it is real).
   No em dashes in any copy.
10. **Accessible by default.** Every interactive element is reachable and labelled; focus
    rings are visible; colour is never the only signal; contrast passes WCAG AA in both
    themes (the tokens are checked).

## Patterns

- **Course card**: cover (16:9, `rounded-t-card`, generated art when there is no cover), title
  (display, 2 lines), instructor line, meta line, rating with stars, price or access state
  pinned to the bottom. A frosted bookmark button sits top-right on the cover.
- **Course page**: a hero band (breadcrumb, title, subtitle, meta line, instructors, rating),
  a sticky purchase card on the right from `lg`, a sticky underline tab strip with
  scroll-spy, then sections: what you will learn (two columns of checks), curriculum
  accordion (preview items open a player dialog), instructors, reviews, FAQ-like
  prerequisites. On phones the purchase card becomes a sticky bottom bar.
- **Classroom**: full-height, no site header. The player (or article or PDF) on the left,
  the curriculum on the right in its own scroll area with progress rings; a slim top bar
  with the course title, progress and "Next"; tabs below the player for Overview, Notes,
  Q&A and Resources.
- **Admin**: a left sidebar of areas (only those the role may open), a page header with the
  title and the primary action, then the content as tables with hairline rows, filters as
  underline tabs plus one search field, and detail in a right-side sheet.
- **Empty states**: one sentence of what this is and one action, using `EmptyState`.
- **Money**: always `formatMoney(money)` from `lib/money.ts` (Intl, the currency's own
  decimals). Never format minor units by hand.
- **Dates**: `lib/time.ts` helpers; relative for recent activity, absolute for receipts.
