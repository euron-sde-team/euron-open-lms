/**
 * The demo academy's catalog: invented courses with real-looking curricula, written for
 * the demo only. Every name, course and organisation here is fictional.
 */

export interface DemoQuestion {
  kind: "SINGLE" | "MULTI" | "TRUE_FALSE" | "SHORT_TEXT";
  prompt: string;
  explanation: string;
  options?: [string, boolean][];
  accepted?: string[];
}

export type DemoItem =
  | { kind: "VIDEO"; title: string; minutes: number; preview?: boolean; notes?: string }
  | { kind: "ARTICLE"; title: string; minutes: number; body: string; preview?: boolean }
  | { kind: "PDF"; title: string; minutes: number; heading: string; points: string[] }
  | { kind: "QUIZ"; title: string; pass: number; minutes: number; questions: DemoQuestion[]; attempts?: number; timed?: number }
  | { kind: "ASSIGNMENT"; title: string; minutes: number; instructions: string; rubric: [string, string, number][]; dueDays?: number };

export interface DemoCourse {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "ALL_LEVELS";
  access: "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
  usd?: number;
  inr?: number;
  compareUsd?: number;
  featured?: boolean;
  inPlan?: boolean;
  instructors: number[];
  description: string;
  outcomes: string[];
  prerequisites: string[];
  sections: { title: string; items: DemoItem[] }[];
}

export const CATEGORIES = [
  { slug: "software-engineering", name: "Software engineering", description: "Write, review and ship code that lasts." },
  { slug: "data-and-ai", name: "Data and AI", description: "From SQL to models, with the statistics in between." },
  { slug: "design", name: "Design", description: "Interfaces people understand and trust." },
  { slug: "product-and-business", name: "Product and business", description: "Decide what to build and say it clearly." },
  { slug: "cloud-and-devops", name: "Cloud and DevOps", description: "Run software calmly in production." },
] as const;

export const INSTRUCTORS = [
  { name: "Maya Okafor", headline: "Staff engineer, TypeScript and API design", bio: "Maya has spent twelve years building backend systems for payments and logistics teams, and the last five teaching engineers to design APIs they will not regret." },
  { name: "Daniel Reyes", headline: "Data scientist and statistics teacher", bio: "Daniel turns messy data into decisions. He has led analytics teams in retail and healthcare and teaches statistics without the fear." },
  { name: "Priya Raman", headline: "Product designer and accessibility advocate", bio: "Priya designs interfaces for public services and fintech. She cares about clarity, accessibility and the small details that build trust." },
] as const;

export const LEARNERS = [
  "Juniper Vale", "Theo Marsh", "Amara Lindqvist", "Kenji Watanabe", "Sofia Delgado", "Noah Brennan", "Leila Haddad", "Oscar Nyberg", "Ava Castellanos",
  "Rohan Mehta", "Isla Fitzgerald", "Mateo Ruiz", "Hana Kobayashi", "Elias Moreau", "Zara Ahmed", "Lucas Ferreira", "Mira Petrova", "Samuel Osei",
  "Clara Jensen", "Arjun Nair", "Nina Kowalski", "Felix Hartmann", "Yara Saleh", "Ethan Park", "Lina Bauer", "Omar Farouk", "Grace Liu",
  "Tomás Silva", "Ingrid Solberg", "Kofi Mensah", "Anika Sharma", "Leo Rossi", "Chloe Martin", "Dev Patel", "Esme Walsh", "Hugo Lambert",
] as const;

const vid = (title: string, minutes: number, preview = false, notes?: string): DemoItem => ({ kind: "VIDEO", title, minutes, preview, notes });
const art = (title: string, minutes: number, body: string, preview = false): DemoItem => ({ kind: "ARTICLE", title, minutes, body, preview });

const TS_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "What does `unknown` force you to do before using a value?", explanation: "`unknown` is the safe top type: you must narrow it (with a check or a type guard) before you can use it.", options: [["Narrow it with a check", true], ["Cast it to `any`", false], ["Nothing, it behaves like `any`", false]] },
  { kind: "MULTI", prompt: "Which of these narrow a union type?", explanation: "`typeof`, `in` and a discriminant comparison all narrow. A type assertion only tells the compiler to trust you.", options: [["`typeof x === \"string\"`", true], ["`\"id\" in x`", true], ["`x.kind === \"circle\"`", true], ["`x as Circle`", false]] },
  { kind: "TRUE_FALSE", prompt: "A `readonly` array type stops you from calling `push` on it.", explanation: "`readonly T[]` (or `ReadonlyArray<T>`) removes the mutating methods from the type.", options: [["True", true], ["False", false]] },
  { kind: "SHORT_TEXT", prompt: "Which keyword checks that a value matches a type without widening it (TypeScript 4.9+)?", explanation: "`satisfies` checks against a type and keeps the narrower inferred type.", accepted: ["satisfies"] },
  { kind: "SINGLE", prompt: "What is the main benefit of a discriminated union?", explanation: "The compiler can check that every case is handled, and narrows the type inside each branch.", options: [["Exhaustive, narrowed handling of each case", true], ["Faster runtime performance", false], ["Smaller bundles", false]] },
];

const SQL_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "Which clause filters groups after aggregation?", explanation: "`WHERE` filters rows before grouping; `HAVING` filters the groups.", options: [["HAVING", true], ["WHERE", false], ["ORDER BY", false]] },
  { kind: "SINGLE", prompt: "A LEFT JOIN from customers to orders returns...", explanation: "Every customer appears; those without orders get NULLs in the order columns.", options: [["Every customer, with NULLs where there is no order", true], ["Only customers with orders", false], ["Only orders without customers", false]] },
  { kind: "TRUE_FALSE", prompt: "`COUNT(column)` counts NULL values.", explanation: "`COUNT(column)` skips NULLs; `COUNT(*)` counts rows.", options: [["True", false], ["False", true]] },
  { kind: "MULTI", prompt: "Which are window functions?", explanation: "`ROW_NUMBER`, `LAG` and `SUM(...) OVER` are window functions; `GROUP BY` is a clause.", options: [["ROW_NUMBER()", true], ["LAG()", true], ["SUM(x) OVER (...)", true], ["GROUP BY", false]] },
];

const ML_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "A model scores well on training data and poorly on new data. This is...", explanation: "That gap is overfitting: the model learned noise in the training set.", options: [["Overfitting", true], ["Underfitting", false], ["Data leakage", false]] },
  { kind: "SINGLE", prompt: "Why keep a test set you never tune on?", explanation: "It is the only honest estimate of performance on unseen data.", options: [["To get an honest estimate on unseen data", true], ["To train faster", false], ["To balance the classes", false]] },
  { kind: "MULTI", prompt: "Which help against overfitting?", explanation: "More data, regularisation and simpler models all reduce variance.", options: [["More training data", true], ["Regularisation", true], ["A simpler model", true], ["Evaluating on the training set", false]] },
  { kind: "TRUE_FALSE", prompt: "Accuracy is a good metric when 99% of examples are negative.", explanation: "With heavy class imbalance, always predicting negative scores 99% accuracy and is useless; use precision and recall.", options: [["True", false], ["False", true]] },
  { kind: "SHORT_TEXT", prompt: "What do we call a feature that leaks the answer into training?", explanation: "Leakage makes offline results look great and production results collapse.", accepted: ["leakage", "data leakage", "target leakage"] },
];

const DESIGN_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "The minimum contrast ratio for body text under WCAG AA is...", explanation: "AA asks for 4.5:1 for normal text and 3:1 for large text.", options: [["4.5:1", true], ["3:1", false], ["7:1", false]] },
  { kind: "TRUE_FALSE", prompt: "Colour alone should signal an error state.", explanation: "Pair colour with text or an icon so people who cannot see the colour still get the message.", options: [["True", false], ["False", true]] },
  { kind: "MULTI", prompt: "Which make a form easier to complete?", explanation: "Visible labels, inline errors and sensible defaults all reduce effort; placeholder-only labels disappear when typing.", options: [["Visible labels", true], ["Errors next to the field", true], ["Sensible defaults", true], ["Placeholder text instead of labels", false]] },
];

const API_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "Which method should be safe to retry without side effects?", explanation: "PUT is idempotent by definition; POST needs an idempotency key to be retried safely.", options: [["PUT", true], ["POST", false], ["PATCH (always)", false]] },
  { kind: "SINGLE", prompt: "A client gets 409 Conflict. What does that usually mean?", explanation: "The request conflicts with the current state, for example an edit based on a stale version.", options: [["The request conflicts with the current state", true], ["The client is not signed in", false], ["The server crashed", false]] },
  { kind: "MULTI", prompt: "Good error responses include...", explanation: "A stable machine code, a human message and a request id make errors debuggable.", options: [["A stable error code", true], ["A human-readable message", true], ["A request id", true], ["The server's stack trace", false]] },
  { kind: "TRUE_FALSE", prompt: "Keyset pagination stays fast on deep pages where OFFSET slows down.", explanation: "Keyset seeks straight to the cursor using an index; OFFSET still reads and discards the skipped rows.", options: [["True", true], ["False", false]] },
];

const STATS_QUIZ: DemoQuestion[] = [
  { kind: "SINGLE", prompt: "The median of 2, 3, 3, 8, 40 is...", explanation: "Sorted, the middle value is 3. The mean (11.2) is pulled up by the outlier.", options: [["3", true], ["11.2", false], ["8", false]] },
  { kind: "TRUE_FALSE", prompt: "Correlation proves causation.", explanation: "Correlation can come from a confounder, chance or reverse causation.", options: [["True", false], ["False", true]] },
  { kind: "SINGLE", prompt: "A 95% confidence interval means...", explanation: "If you repeated the study many times, about 95% of intervals built this way would contain the true value.", options: [["95% of such intervals would contain the true value", true], ["There is a 95% chance the data are correct", false], ["95% of the data fall inside it", false]] },
];

export const COURSES: DemoCourse[] = [
  {
    slug: "modern-typescript",
    title: "Modern TypeScript from First Principles",
    subtitle: "Types that catch real bugs, without fighting the compiler",
    category: "software-engineering",
    level: "INTERMEDIATE",
    access: "PAID",
    usd: 4900,
    inr: 399900,
    compareUsd: 7900,
    featured: true,
    instructors: [0],
    description:
      "TypeScript pays off when the types describe what your code really does. This course builds that skill from the ground up: narrowing, unions, generics and the patterns that keep large codebases honest.\n\nYou will refactor a small but realistic service step by step, and finish with a checklist you can bring to code review.\n\n- Model data so invalid states cannot be represented\n- Write generics that read like documentation\n- Know when a type is too clever, and what to do instead",
    outcomes: ["Model domain data with discriminated unions", "Narrow safely instead of casting", "Write readable generic helpers", "Type an API client end to end", "Spot over-engineered types in review"],
    prerequisites: ["Comfortable with JavaScript", "Node.js installed"],
    sections: [
      { title: "Getting oriented", items: [vid("Why types, and which ones", 6, true), art("How to take this course", 4, "## How this course works\n\nEach section ends with a short quiz. The project at the end is reviewed by an instructor.\n\nKeep a scratch file open and type along: reading types is a skill you build with your hands.")] },
      { title: "Narrowing and unions", items: [vid("unknown, any and never", 11), vid("Narrowing with typeof, in and guards", 13), vid("Discriminated unions", 12), { kind: "QUIZ", title: "Check your understanding: narrowing", pass: 60, minutes: 8, questions: TS_QUIZ, attempts: 3 }] },
      { title: "Generics that read well", items: [vid("Your first generic function", 9), vid("Constraints and defaults", 10), { kind: "PDF", title: "Cheat sheet: generics", minutes: 5, heading: "Generics cheat sheet", points: ["Start concrete, generalise once a second caller appears", "Name type parameters after what they mean, not T, U, V", "Constrain with extends only as far as the body needs", "Prefer overloads to conditional types for public APIs", "If the error message is unreadable, the type is too clever"] }] },
      { title: "Project", items: [{ kind: "ASSIGNMENT", title: "Type an API client", minutes: 90, instructions: "Take the starter client in the course resources and give it full types:\n\n1. Model every response as a type, with errors as a discriminated union.\n2. Make invalid requests fail to compile.\n3. Write a short note on one type you decided *not* to make generic, and why.\n\nSubmit a link to your repository or a zip of the project.", rubric: [["Correctness", "Types match the API and compile without casts", 10], ["Design", "Invalid states cannot be represented", 10], ["Clarity", "Names and the note explain the decisions", 5]], dueDays: 21 }] },
    ],
  },
  {
    slug: "practical-sql",
    title: "Practical SQL for Analysts",
    subtitle: "Answer real business questions with queries you can explain",
    category: "data-and-ai",
    level: "BEGINNER",
    access: "PAID",
    usd: 3900,
    inr: 299900,
    instructors: [1],
    description: "Start from SELECT and finish writing window functions with confidence. Every lesson uses the same fictional shop's data, so each new idea builds on the last.\n\nBy the end you can turn a vague question from a colleague into a precise query, and explain the result.",
    outcomes: ["Filter, sort and aggregate with confidence", "Join tables without losing or duplicating rows", "Use window functions for running totals and rankings", "Explain a query's result to a non-technical colleague"],
    prerequisites: ["No prior SQL needed"],
    sections: [
      { title: "Asking the database", items: [vid("Your first SELECT", 7, true), vid("Filtering and sorting", 9), art("The shop dataset", 5, "## Meet the data\n\nThe shop has four tables: `customers`, `orders`, `order_items` and `products`. Each order belongs to one customer; each item to one order and one product.\n\nKeep this page open as a reference while you work through the lessons.")] },
      { title: "Joins and groups", items: [vid("INNER and LEFT joins", 12), vid("GROUP BY and HAVING", 11), { kind: "QUIZ", title: "Quiz: joins and aggregation", pass: 70, minutes: 6, questions: SQL_QUIZ }] },
      { title: "Window functions", items: [vid("Running totals", 10), vid("Rankings with ROW_NUMBER", 9)] },
    ],
  },
  {
    slug: "machine-learning-foundations",
    title: "Machine Learning Foundations",
    subtitle: "Build, evaluate and explain your first models honestly",
    category: "data-and-ai",
    level: "INTERMEDIATE",
    access: "PAID",
    usd: 7900,
    inr: 599900,
    compareUsd: 9900,
    featured: true,
    instructors: [1],
    description: "Machine learning without the hype. You will train models on tabular data, evaluate them the way a sceptical reviewer would, and learn to say what a model can and cannot do.\n\nThe focus is judgement: picking metrics, avoiding leakage, and knowing when a simple baseline wins.",
    outcomes: ["Frame a prediction problem and choose a metric", "Split data without leaking the answer", "Train and compare baseline and tree models", "Explain a model's errors to stakeholders"],
    prerequisites: ["Basic Python", "Comfortable with averages and percentages"],
    sections: [
      { title: "Framing the problem", items: [vid("What a model is, and is not", 8, true), vid("Choosing a metric", 12)] },
      { title: "Honest evaluation", items: [vid("Train, validation and test", 11), vid("Leakage, the silent bug", 13), { kind: "QUIZ", title: "Quiz: evaluation", pass: 60, minutes: 10, questions: ML_QUIZ, attempts: 2, timed: 600 }] },
      { title: "Models", items: [vid("Baselines first", 9), vid("Decision trees and forests", 14), art("Reading a confusion matrix", 6, "## Four boxes\n\nA confusion matrix splits predictions into true positives, false positives, true negatives and false negatives.\n\n**Precision** asks: of the things we flagged, how many were right? **Recall** asks: of the things we should have flagged, how many did we catch?")] },
      { title: "Project", items: [{ kind: "ASSIGNMENT", title: "Predict and explain churn", minutes: 120, instructions: "Using the churn dataset in the resources, build a model that beats the baseline and write a one-page report a manager could act on.\n\nInclude your metric choice, how you avoided leakage, and the two biggest error patterns.", rubric: [["Method", "Sound split, no leakage, a baseline", 10], ["Results", "Clear metric and fair comparison", 10], ["Communication", "A manager could act on the report", 10]], dueDays: 30 }] },
    ],
  },
  {
    slug: "interfaces-people-trust",
    title: "Designing Interfaces People Trust",
    subtitle: "Clarity, honesty and accessibility in everyday screens",
    category: "design",
    level: "ALL_LEVELS",
    access: "SUBSCRIPTION_ONLY",
    instructors: [2],
    description: "Trust is earned in small moments: a clear label, an honest price, an error that says what to do next. This course collects those moments into patterns you can apply on Monday.",
    outcomes: ["Write labels and errors that help", "Design forms people finish", "Check contrast and keyboard paths", "Remove dark patterns from a flow"],
    prerequisites: ["None"],
    sections: [
      { title: "Foundations", items: [vid("What trust looks like on screen", 7, true), vid("Hierarchy and reading order", 10)] },
      { title: "Forms and errors", items: [vid("Labels, hints and defaults", 9), vid("Errors that say what to do", 8), { kind: "QUIZ", title: "Quiz: accessible forms", pass: 70, minutes: 5, questions: DESIGN_QUIZ }] },
      { title: "Accessibility in practice", items: [vid("Contrast and colour", 9), vid("Keyboard and focus", 11)] },
    ],
  },
  {
    slug: "git-and-code-review",
    title: "Git and Code Review Habits",
    subtitle: "Small commits, kind reviews, calm merges",
    category: "software-engineering",
    level: "BEGINNER",
    access: "FREE",
    instructors: [0],
    description: "A short, free course on the habits that make teams fast: commits that tell a story, pull requests that are easy to review, and reviews that improve code without bruising people.",
    outcomes: ["Write commits a teammate can follow", "Split work into reviewable pull requests", "Give review comments that land well"],
    prerequisites: ["Git installed"],
    sections: [
      { title: "Commits", items: [vid("A commit is a message to the future", 6, true), vid("Rebasing without fear", 9)] },
      { title: "Reviews", items: [vid("Reviewable pull requests", 8), art("A review checklist", 4, "## Before you approve\n\n- Does the change do what the description says?\n- Is there a test for the behaviour, not the implementation?\n- Would you understand this code in six months?\n- Is every comment about the code, not the person?")] },
    ],
  },
  {
    slug: "product-discovery",
    title: "Product Discovery in Practice",
    subtitle: "Decide what to build with evidence, not opinions",
    category: "product-and-business",
    level: "INTERMEDIATE",
    access: "PAID",
    usd: 5900,
    inr: 449900,
    instructors: [2],
    description: "Discovery is how teams avoid building the wrong thing well. Learn to frame problems, run interviews that teach you something, and test ideas cheaply before writing code.",
    outcomes: ["Frame an opportunity as a problem worth solving", "Run interviews without leading questions", "Test risky assumptions cheaply", "Share findings that change decisions"],
    prerequisites: ["Some experience on a product team"],
    sections: [
      { title: "Problems first", items: [vid("Outcomes over outputs", 8, true), vid("Opportunity trees", 11)] },
      { title: "Learning from people", items: [vid("Interviews that teach you something", 12), art("Interview script template", 5, "## A script that does not lead\n\n1. Tell me about the last time you...\n2. What happened next?\n3. What was the hardest part?\n4. What did you try?\n\nAvoid: *Would you use...?* People are generous about the future and accurate about the past.")] },
      { title: "Testing ideas", items: [vid("Assumption mapping", 9), vid("Cheap experiments", 10)] },
    ],
  },
  {
    slug: "containers-and-kubernetes",
    title: "Containers and Kubernetes, Calmly",
    subtitle: "Run services in production without the drama",
    category: "cloud-and-devops",
    level: "INTERMEDIATE",
    access: "PAID",
    usd: 6900,
    inr: 499900,
    instructors: [0],
    description: "Containers and Kubernetes explained by what problems they solve. Build an image, deploy a service, roll out a change, and debug it when it misbehaves.",
    outcomes: ["Build small, reproducible images", "Deploy and roll back a service", "Read logs and events when things go wrong", "Set resource limits that hold up"],
    prerequisites: ["Comfortable on the command line"],
    sections: [
      { title: "Images", items: [vid("What a container really is", 8, true), vid("Writing a good Dockerfile", 12)] },
      { title: "Kubernetes basics", items: [vid("Pods, deployments and services", 13), vid("Rolling updates and rollbacks", 10)] },
      { title: "When it breaks", items: [vid("Reading events and logs", 11), art("A debugging checklist", 5, "## When a pod will not start\n\n1. `kubectl describe pod` and read the events from the bottom.\n2. Check the image name and pull secret.\n3. Check resource requests against the node.\n4. Read the previous container's logs with `--previous`.")] },
    ],
  },
  {
    slug: "statistics-for-decisions",
    title: "Statistics for Decision Making",
    subtitle: "Read numbers with confidence and spot the misleading ones",
    category: "data-and-ai",
    level: "BEGINNER",
    access: "PAID",
    usd: 4500,
    inr: 349900,
    instructors: [1],
    description: "The statistics you need at work, explained with everyday examples: averages that mislead, uncertainty you can communicate, and experiments you can trust.",
    outcomes: ["Choose between mean and median", "Explain uncertainty with intervals", "Read an A/B test result correctly"],
    prerequisites: ["None"],
    sections: [
      { title: "Describing data", items: [vid("Averages that mislead", 8, true), vid("Spread and outliers", 9)] },
      { title: "Uncertainty", items: [vid("Confidence intervals in plain words", 11), { kind: "QUIZ", title: "Quiz: reading the numbers", pass: 67, minutes: 5, questions: STATS_QUIZ }] },
      { title: "Experiments", items: [vid("A/B tests without fooling yourself", 12)] },
    ],
  },
  {
    slug: "accessible-front-end",
    title: "Accessible Front-End Engineering",
    subtitle: "Ship interfaces that work for everyone, by default",
    category: "design",
    level: "ADVANCED",
    access: "PAID",
    usd: 5900,
    inr: 449900,
    instructors: [2, 0],
    description: "Accessibility built into your components instead of patched on before launch. Semantic HTML, focus management, live regions and testing with real assistive technology.",
    outcomes: ["Build accessible dialogs, menus and tabs", "Manage focus in single-page apps", "Test with a screen reader"],
    prerequisites: ["Experience building React or Vue components"],
    sections: [
      { title: "Semantics", items: [vid("HTML that already works", 9, true), vid("Names, roles and states", 11)] },
      { title: "Interactive components", items: [vid("Dialogs and focus traps", 13), vid("Menus and tabs", 12)] },
    ],
  },
  {
    slug: "writing-for-software-teams",
    title: "Writing for Software Teams",
    subtitle: "Design docs, updates and messages people actually read",
    category: "product-and-business",
    level: "ALL_LEVELS",
    access: "FREE",
    instructors: [2],
    description: "Clear writing is a force multiplier. A short free course on design docs, status updates and the messages that unblock people.",
    outcomes: ["Write a one-page design doc", "Send updates that answer the obvious questions", "Edit your own writing quickly"],
    prerequisites: ["None"],
    sections: [{ title: "Writing that works", items: [vid("Lead with the decision", 6, true), vid("The one-page design doc", 10), art("An update template", 3, "## Status update\n\n**Where we are:** one sentence.\n\n**What changed:** two or three bullets.\n\n**What we need:** a name and a date.")] }],
  },
  {
    slug: "building-reliable-apis",
    title: "Building Reliable APIs",
    subtitle: "Idempotency, pagination, errors and the details that matter in production",
    category: "software-engineering",
    level: "ADVANCED",
    access: "PAID",
    usd: 8900,
    inr: 699900,
    featured: true,
    instructors: [0],
    description: "The difference between an API that works in a demo and one that works at three in the morning. Retries and idempotency keys, keyset pagination, error contracts, and webhooks that survive duplicates.\n\nEvery lesson ends with a pattern you can lift into your own codebase.",
    outcomes: ["Make writes safe to retry", "Paginate large lists with keyset cursors", "Design error responses clients can act on", "Receive webhooks idempotently"],
    prerequisites: ["You have built and shipped an HTTP API"],
    sections: [
      { title: "Contracts", items: [vid("What reliable means", 7, true), vid("Error responses clients can use", 11)] },
      { title: "Retries", items: [vid("Idempotency keys", 13), vid("Conditional updates and races", 12), { kind: "QUIZ", title: "Quiz: safe writes", pass: 75, minutes: 6, questions: API_QUIZ, attempts: 3 }] },
      { title: "Lists and events", items: [vid("Keyset pagination", 10), vid("Webhooks that survive duplicates", 12)] },
      { title: "Project", items: [{ kind: "ASSIGNMENT", title: "Harden a checkout endpoint", minutes: 120, instructions: "The starter service in the resources has a checkout endpoint that double-charges under retries. Fix it:\n\n1. Add idempotency keys.\n2. Make the status change a conditional update.\n3. Write a test that fires two requests at once.", rubric: [["Safety", "No double charge under concurrent retries", 15], ["Tests", "A test proves the race is handled", 10], ["Clarity", "The change is easy to review", 5]] }] },
    ],
  },
  {
    slug: "data-visualization-that-explains",
    title: "Data Visualization that Explains",
    subtitle: "Charts that answer a question at a glance",
    category: "design",
    level: "INTERMEDIATE",
    access: "SUBSCRIPTION_ONLY",
    instructors: [1, 2],
    description: "Pick the right chart, remove what distracts, and write the title that tells people what to see. With before and after examples from real dashboards.",
    outcomes: ["Choose a chart for the question", "Declutter a busy chart", "Write chart titles that state the finding"],
    prerequisites: ["None"],
    sections: [
      { title: "Choosing", items: [vid("Start from the question", 7, true), vid("Bars, lines and when not to pie", 10)] },
      { title: "Refining", items: [vid("Removing chart junk", 9), vid("Titles that state the finding", 6)] },
    ],
  },
];

export const REVIEW_LINES: [number, string][] = [
  [5, "Clear, practical and well paced. I used the checklist at work the next day."],
  [5, "The best explanation of this topic I have found. The project tied it all together."],
  [4, "Very good. I would have liked one more worked example in the middle section."],
  [5, "Exactly the right depth. No filler, every lesson earned its place."],
  [4, "Great content and kind feedback on my project. Audio is a little quiet in places."],
  [3, "Solid foundations, but I already knew most of the first half."],
  [5, "I finally understand this. Thank you for the patient explanations."],
  [4, "Helpful and honest about trade-offs. The quizzes were a good check."],
];

export const QA_THREADS: { title: string; body: string; answer: string }[] = [
  { title: "Is the starter project available as a zip?", body: "I cannot clone from my work machine. Is there a download?", answer: "Yes: it is in the resources tab of the project lesson. Both the zip and the repository link are there." },
  { title: "Why does the second example compile but the first does not?", body: "They look the same to me, apart from the order of the checks.", answer: "Order matters: after the first check the type is narrowed, so the second line only sees the remaining cases. Swap them and you will see the same error." },
  { title: "How much time should I plan per week?", body: "I want to finish in a month.", answer: "About three hours a week gets most people through in a month, including the project." },
  { title: "Can I use a different dataset for the project?", body: "I have similar data from my own job.", answer: "Please do, as long as you can share it (or a sample with private fields removed) with your submission." },
];
