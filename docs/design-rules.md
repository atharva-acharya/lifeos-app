# Design rules: cards and spacing

One page of concrete rules for Life OS screens, distilled from four design references (read, not run) and Apple Health's iOS layout. Where a source disagrees with Apple Health, Apple Health wins, because that is the look this app is after.

Sources: [dimensional-drawing](https://github.com/enesozturk/dimensional-drawing) (measure components as a system of variables), [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (UX guideline tables), [Hallmark](https://github.com/Nutlope/hallmark) (anti-generic floor, data viz, dark mode), [Emil Kowalski's skills](https://github.com/emilkowalski/skills) (`emil-design-eng`, `apple-design`).

## 1. Surfaces

- Page `#000`, card `#1C1C1E`, raised control `#2C2C2E`, separator `#38383A`. A card is always lighter than the surface under it (Hallmark: "a card darker than its ground reads as a hole"). Hallmark says never use pure black; Apple Health uses it on OLED, so we keep it.
- **No card inside a card** (Hallmark floor 11). Inside a card, group with separators or a raised `#2C2C2E` well, never another bordered card.
- No shadows and no borders on cards. Elevation is lightness. The only outline is the breathing highlight on the one active item.
- **One radius per nesting level** (Hallmark F15): card 14 px, control and inner well 10 px, pill 999 px. An element inset by 4 px or less inside another uses the outer radius minus the inset, so the corners stay concentric (dimensional-drawing: `R2 = R1 − inset`).

## 2. Spacing (a system, not per-screen values)

| Code | Value | Use                                                      |
| ---- | ----- | -------------------------------------------------------- |
| S1   | 16 px | card padding, gap between cards                          |
| S2   | 20 px | gutter between sections, page side padding inside `main` |
| S3   | 8 px  | heading to its card, label to value                      |
| S4   | 12 px | rows inside a card, items in a list                      |
| S5   | 32 px | page header to first section                             |

- Every card on every page uses S1 padding and S1 gaps. Sections are separated by S2. No other values appear without a reason written next to them.
- Grids line up: cards in one row share height (`align-items: stretch`), and columns share one gap.

## 3. Section headings sit outside cards

- A group's title is a heading **above** the card, in sentence case: 17 px semibold, `#F5F5F7`, 8 px above the card. Optional trailing action (e.g. "Show all") right-aligned in accent blue.
- **No tracked capitals and no eyebrows** (Hallmark floor 9). The page date above the title is sentence case muted text, not an uppercase kicker.

## 4. Metric card (Apple Health's summary tile)

```
┌──────────────────────────────────────────┐
│ ● Steps                         10:24  › │  label: 15 px semibold, category colour; chevron muted
│                                          │
│ 6,500 steps                              │  value: 28-34 px bold, tabular; unit 15 px muted
└──────────────────────────────────────────┘
```

- Top row: small coloured label (with an optional glyph) on the left, chevron on the right if the card navigates. The chevron appears only when the card is clickable.
- Bottom-left: the big number with the unit set smaller in secondary grey (`#98989F`) on the same baseline. Never colour the number; colour belongs to the label (Hallmark: "text never wears the data colour" applies to charts and numbers alike).
- Optional detail line (change since last, goal) below the value, 13 px muted.
- Category colours: Activity `#FA114F`, Fitness `#30D158`, Body `#BF5AF2`, Heart `#FF375F`, Sleep `#5E5CE6`, Money `#30D158`, Jobs `#FF9F0A`, Projects `#0A84FF`.

## 5. Type

- Size-specific tracking (`apple-design` §15): titles −0.02 em, body 0. Line height 1.1 on numbers and titles, 1.4 on body.
- Tabular numerals on every number: values, axes, tables (Hallmark F6).
- Hierarchy comes from weight and size together, never colour alone.

## 6. Charts

- One y-axis, baseline at zero, 3-5 solid 1 px gridlines in the separator colour (Hallmark data-viz).
- Comparing two values per period: **grouped bars side by side**, not stacked. Stacking hides the smaller value and makes "in vs out" unreadable.
- Bars no thicker than 24 px, with a 2-4 px gap inside a group. Round only the data end (≤ 4 px).
- Labels and values are text colour; a series is identified by a swatch, not dyed words.

## 7. Motion (Emil Kowalski)

- Keyboard-triggered actions (Ctrl K, tab switches by key) do not animate.
- UI transitions stay under 300 ms, ease-out to enter, and exits are faster than entries. Never `transition: all`, never `ease-in`.
- Pressable cards get `transform: scale(0.98)` on `:active`, 120-160 ms. Hover effects sit behind `@media (hover: hover)`.
- `prefers-reduced-motion` turns movement into nothing or a cross-fade.

## 8. Checks before merging a UI change

- Contrast: body text ≥ 4.5:1 and large numbers ≥ 3:1 against their card (ui-ux-pro-max: Color Contrast, High).
- Targets ≥ 24 × 24 px (WCAG 2.2 AA).
- Long names wrap (`overflow-wrap: anywhere`) and never force horizontal scroll.
- Home fits the minimum window with no scroll; every other page scrolls vertically only.
- Screenshot every page at the minimum and default window sizes, with sample data.
