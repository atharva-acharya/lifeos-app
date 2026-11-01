# UI spec

The strict requirements every screen is checked against. `docs/design-rules.md` explains the reasoning; this file is the contract. A requirement is either met or it is a bug. Numbers here win over anything in code comments.

**Direction.** Apple's current design language (Liquid Glass, iOS 26 and 27) for structure and motion, with patterns borrowed from apps the owner uses: Bevel (health and fitness visuals), Revolut (money layout, quick actions, motion) and Splitwise (splitting and settling up). Patterns, never copies: no logos, screens, names or assets from those apps.

**Not targeted:** the redesigned Health app shown in the iOS 27.2 beta, which Apple pulled before release. It is a moving target until it ships.

## 1. Layers

| ID  | Requirement                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Two layers. **Content** (cards, lists, charts) has no blur: cards are lit from above and slightly translucent so the page glow tints them. **Chrome** (top bar, rail when widened, page toolbar, sheets, popovers, menus, toasts) is glass. No content card uses `backdrop-filter`. |
| L2  | Glass never sits on glass. A popover over a sheet is solid `#2C2C2E`.                                                                                                                                                                                                               |
| L3  | Glass: `background: rgb(28 28 30 / 0.72)`, `backdrop-filter: blur(24px) saturate(160%)`, inner top edge `inset 0 1px 0 rgb(255 255 255 / 0.08)`. No glass element's ancestor may have `filter`, `opacity < 1` or a running animation, or the backdrop breaks.                       |
| L4  | Content scrolls beneath the sidebar and the page toolbar. Where content meets glass, a 24 px scroll-edge fade replaces any hard divider. The fade shows only once the area has scrolled.                                                                                            |
| L5  | Reduce transparency (system setting or the app's own toggle): every glass surface becomes solid `#1C1C1E` with a 1 px `#38383A` border.                                                                                                                                             |
| L6  | Increase contrast: secondary text reaches at least 4.5:1 on its surface, and glass edges become `rgb(255 255 255 / 0.24)`.                                                                                                                                                          |

## 2. Tokens

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Colours come only from `tokens.css`. No hex value appears in a component stylesheet or TSX file.                                                                                                                                                                                                                                                                 |
| T2  | Surfaces: page a blue-grey gradient `#0F131B` to `#0B0E14`; card `--card-top` to `--card-bottom` (lit from above, 1 px top highlight, soft wide shadow), solid `#1A1F2A` where something sticks over rows; raised control `#262C38`; separator `#323A48`. Each page has one soft glow in its colour at 10 to 15%. A card is always lighter than what it sits on. |
| T3  | Colour is for data and state, not decoration: about 5% of a screen's pixels or less. Headings, labels and numbers are text colours. A series or category is marked by a swatch or label colour, never by dyeing the number.                                                                                                                                      |
| T4  | Category colours (labels and chart series): Activity `#FF9F0A`, Jobs `#2DD4BF` (teal), Heart `#FF6482`, Body `#DA8FFF`, Sleep `#8E8CFF`, Fitness `#30D158`, Money `#8B7CFF` (purple-blue), Projects `#5EB0FF`. Positive money is green; amounts you owe are orange, always with text, never colour alone.                                                        |
| T5  | Radii are concentric: inner radius = outer radius − inset, floor 4 px. Card 14, control in a card 10, pill 999; 6 only for a segment inside a 10 px control with a 4 px inset.                                                                                                                                                                                   |
| T6  | Spacing uses only 4, 8, 12, 16, 20, 24 and 32 px: 16 inside cards and between cards, 20 between sections, 32 under the page title. 24 is the larger in-component step only (sidebar groups, ring to legend, setting text to its control, list indent, page bottom).                                                                                              |
| T7  | Type scale: page title 34/1.1 bold −0.02 em; group title 20/1.3 bold; metric value 30/1.1 bold, tabular; label 15 semibold; body 14/1.5; secondary 13; page bar title 17 semibold (as iOS); chart tick 12 (axis ticks only). Sizes come from tokens. Sentence case everywhere. No uppercase, no letter-spaced labels.                                            |
| T8  | Every number uses tabular figures. Zero prints as `0`, a missing value as `—`, never blank.                                                                                                                                                                                                                                                                      |

## 3. Motion

Durations come from tokens. Reduce motion sets them all to 0, and no element then moves or scales; it only appears.

| ID  | What                                                                                                | How                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M1  | Press on anything clickable                                                                         | scale 0.97, 120 ms ease-out; release with the spring (`--ease-spring`), 200 ms                                  |
| M2  | Hover                                                                                               | colour or background only, 120 ms; only under `(hover: hover) and (pointer: fine)`                              |
| M3  | Page change (mouse)                                                                                 | old page fades out 120 ms; new page fades in and rises 8 px, 240 ms spring                                      |
| M4  | Anything triggered from the keyboard (Ctrl K, arrow keys in tabs, shortcuts)                        | no animation, instant                                                                                           |
| M5  | Sheet or popover opens                                                                              | from its trigger, not the screen centre: scale 0.96 → 1 and fade, 280 ms spring; closes faster, 160 ms ease-out |
| M6  | Rings                                                                                               | fill 800 ms spring, 60 ms stagger between rings                                                                 |
| M7  | Line charts draw in 480 ms; bars grow 320 ms spring                                                 | first paint only, never on every data refresh                                                                   |
| M8  | Lists                                                                                               | new rows fade and rise 6 px, 200 ms, stagger 30 ms, at most 8 rows staggered                                    |
| M9  | Number changes (balance, totals)                                                                    | count to the new value over 400 ms ease-out                                                                     |
| M10 | Nothing loops except a loading indicator and the single "active project" highlight                  |                                                                                                                 |
| M11 | Only `transform`, `opacity` and colours animate. Never `transition: all`, never `ease-in` on entry. |                                                                                                                 |

## 4. Components

| ID  | Requirement                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Group:** the title sits above its card, or, for a page that fits the window (Today, Money), inside the card as its first row. An optional action (link or control) goes right-aligned on the same line.              |
| C2  | **Metric card:** coloured label top-left; note and chevron top-right; big value bottom-left with its unit in grey; one optional detail line. Clickable cards open their page, and the whole card is the target.        |
| C3  | **List row:** title plus one secondary line, a trailing value right-aligned at least 64 px wide, a hairline between rows (none above the first). No card or bordered box inside a row.                                 |
| C4  | **Charts:** one y axis, baseline at zero, 3–5 solid gridlines. Two values per period are bars side by side, not stacked. Bars at most 24 px wide, rounded only at the data end. Every chart has a screen-reader table. |
| C5  | **Segmented control** (tabs, ranges, money in/out): glass-free, raised `#2C2C2E` track, selected segment slides (M1 spring), arrow keys move instantly (M4).                                                           |
| C6  | **Buttons:** one primary style per screen; at least 32 px tall with the mouse target at least 24 × 24. Disabled is 50% opacity and says why nearby.                                                                    |
| C7  | **Every screen has five states:** loading, empty (one line plus one action), error (what happened plus a retry), partial (some data missing, shown as `—`), and full.                                                  |
| C8  | **Toasts** confirm saved actions and offer Undo for 5 s when the action can be undone.                                                                                                                                 |

## 5. Pages

| ID  | Page            | Requirement                                                                                                                                                                                                                                                                                                            |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | All             | The window has the app's own top bar (no Windows title bar) and two states: windowed at 80% of the screen at 16:10 (not drag-resizable) and maximised. The webview zoom fits a 1440 × 900 canvas to the window. No page scrolls at that canvas in either state; only long lists scroll inside their own card or panel. |
| P2  | Today           | Habits ring with its checklist; four summary metric cards that open their page; follow-ups (max 3, plus a link to the rest); resume here.                                                                                                                                                                              |
| P3  | Fitness, Health | Rings or scores show actual against target, plus one sentence on what to do next ("2,400 steps to go").                                                                                                                                                                                                                |
| P4  | Health          | Clicking a score or ring opens a **contributors** sheet: each input, its value, and up or down against your own 30-day average.                                                                                                                                                                                        |
| P5  | Money           | Top: the metric row. Quick actions in the page header: Budget, Settle up, Import, Split, Add (the one primary), each with a key. Add, Split and Import are guided flows in sheets that grow from their button.                                                                                                         |
| P6  | Money           | Transactions grouped by day under sticky day headers showing the date and the day's net. Category editable in at most 2 clicks from the row.                                                                                                                                                                           |
| P7  | Money           | Analytics: week, 6-month and year ranges; "vs previous period" change; one breakdown at a time (spending by category, or income by source).                                                                                                                                                                            |
| P8  | Money           | Splitting: equal, exact amounts, percentages and shares. Save stays disabled until the parts add up; a live "£X left to assign" shows the gap.                                                                                                                                                                         |
| P9  | Money           | Friends: one net balance per friend; header shows you owe, you are owed and net. Settle up pre-fills the full amount and records a payment that can be undone (C8).                                                                                                                                                    |

**Later (needs a data decision first):** Bevel-style composite scores (strain, recovery, readiness). They need a defined formula from the vault and Health data before any UI.

## 6. How a change is checked

1. **Automated:** format, lint, types, unit tests; Playwright e2e against the real app checks the canvas is 1440 × 900 after zoom and that Today does not scroll; every page is screenshotted windowed and maximised before a UI change merges.
2. **Scored critique:** every UI pull request is scored against this file. Each finding is ranked P0 (broken or inaccessible) to P3 (polish). P0 and P1 block merging. The pull request lists the requirement IDs it changes.
3. **Owner check** on Windows before a release: motion and colour, using the `e2e:gate` build.

## 7. Status

Checked against the code on main after the November 2026 redesign (#58 to #63): own window chrome, the scaled canvas, the blue-grey look and pages that fit the window. Screenshots were taken in the real Windows app; motion feel and colour still need the owner check in §6.

| ID  | Status     | Note                                                                                                                                                                           | PR            |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| L1  | Met        | Glass only on the widened rail, page bar, sheets, category popover and toasts; cards are translucent without blur.                                                             | #42, #46, #59 |
| L2  | Met        | No popover opens over a sheet or toast; the unused `--popover-solid` token was removed.                                                                                        | #50           |
| L3  | Met        | Glass tokens match; blur not checked on Windows.                                                                                                                               | #42           |
| L4  | Met        | 24 px scroll-edge fade under the page bar, shown only once scrolled.                                                                                                           | #42, #46      |
| L5  | Met        | System setting and the app's own toggle both switch glass to solid.                                                                                                            | #42           |
| L6  | Met        | `prefers-contrast: more` lifts muted text and glass edges; not checked on Windows.                                                                                             | #42           |
| T1  | Met        | No hex outside `tokens.css`.                                                                                                                                                   | #46           |
| T2  | Met        | Blue-grey surfaces, lit cards and per-page glow tokens.                                                                                                                        | #36, #59      |
| T3  | Partly met | Category colour is on labels and swatches; the 5% budget has not been measured.                                                                                                | #36           |
| T4  | Met        | Category tokens match, Jobs teal and Money purple-blue; owed amounts carry text.                                                                                               | #36, #43, #59 |
| T5  | Met        | Every radius is a token: card, control, pill, `--radius-small` (4 px floor) and `--radius-inset` (6 px, concentric segments only).                                             | #36, #50      |
| T6  | Met        | Only the listed steps are used; 24 px is the documented page-section step.                                                                                                     | #36, #50      |
| T7  | Met        | Every size is a token; documented exceptions: chart ticks 12 px, page bar title 17 px.                                                                                         | #36, #50      |
| T8  | Met        | Tabular figures on every number (tables, pills, ticks, metrics, lists); `—` for missing values.                                                                                | #36, #50      |
| M1  | Met        | Press and release timings from tokens.                                                                                                                                         | #42           |
| M2  | Met        | Hover is colour only, behind the hover media query.                                                                                                                            | #42           |
| M3  | Met        | View Transitions page fade and rise.                                                                                                                                           | #42           |
| M4  | Met        | Keyboard changes skip animation.                                                                                                                                               | #42           |
| M5  | Met        | Sheets grow from their trigger; close faster.                                                                                                                                  | #44           |
| M6  | Met        | Rings fill over 800 ms, 60 ms apart; instant under reduce motion.                                                                                                              | #46, #51      |
| M7  | Met        | Line draw 480 ms, bars 320 ms spring, on mount only.                                                                                                                           | #46           |
| M8  | Met        | Rows rise 6 px, 30 ms stagger, capped at 8.                                                                                                                                    | #42           |
| M9  | Met        | Today summary numbers count to new values over 400 ms; instant on first load and under reduce motion.                                                                          | #47           |
| M10 | Met        | Only the active-project highlight loops.                                                                                                                                       | #42           |
| M11 | Met        | No `transition: all` or ease-in on entry; ring and line drawing animate `stroke-dashoffset`, which M6 and M7 need.                                                             | #42, #46      |
| C1  | Met        | `Group` puts the title above the card; Today and Money cards carry `CardHead` inside.                                                                                          | #36, #59, #60 |
| C2  | Met        | `Metric` layout; clickable cards open their page.                                                                                                                              | #36           |
| C3  | Met        | List rows with a 64 px trailing value and hairlines.                                                                                                                           | #36           |
| C4  | Met        | Bars capped at 24 px; two-value charts side by side; every chart has a screen-reader table.                                                                                    | #48, #50      |
| C5  | Met        | Sliding segmented control, instant on arrow keys.                                                                                                                              | #44           |
| C6  | Met        | One primary per screen, 32 px+ tall, disabled at 50% with the reason shown.                                                                                                    | #40, #43, #50 |
| C7  | Met        | Loading, error with Try again, empty and partial states on every page; Money keeps the previous month dimmed while the next loads.                                             | #47, #53      |
| C8  | Met        | Toast with 5 s Undo for settle-ups and category changes.                                                                                                                       | #43, #50      |
| P1  | Met        | Own top bar, two window states, zoomed 1440 × 900 canvas; Today, Money, Jobs, Settings, Projects, Fitness and Health checked with no page scroll at 1440 × 900 and 1655 × 900. | #58 to #63    |
| P2  | Met        | Habits ring, four summary cards, three follow-ups, resume here.                                                                                                                | #36           |
| P3  | Met        | Fitness and Health rings show actual / target with a next-step line.                                                                                                           | #44           |
| P4  | Met        | Contributors sheet against the 30-day average.                                                                                                                                 | #44           |
| P5  | Met        | Header actions with keys; Add, Split and Import as sheet flows.                                                                                                                | #40, #60      |
| P6  | Met        | Sticky day headers with net; category edit from the row.                                                                                                                       | #41, #45      |
| P7  | Met        | This week, 6 months and this year; totals and categories vs the previous period; one breakdown at a time.                                                                      | #48, #54, #60 |
| P8  | Met        | Equal, exact, percentage and share splits with a live remainder.                                                                                                               | #43           |
| P9  | Met        | Per-friend net, summary header, pre-filled settle-up with Undo.                                                                                                                | #43           |
