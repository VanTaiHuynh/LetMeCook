---
name: Let Me Cook
description: 'Market counter: original food photography, Sunny yellow actions and open kitchen workspaces.'
colors:
  yellow: '#FED369'
  gold: '#FABB4A'
  surface: '#FFFFFF'
  cream: '#FAF7EF'
  ink: '#24231F'
  muted: '#666157'
  line: '#E6E3DB'
  error: '#9A3026'
  danger-line: '#DCA8A0'
  danger-tint: '#FFF0EC'
typography:
  display:
    fontFamily: Raleway, sans-serif
    fontSize: clamp(42px, 4.4vw, 64px)
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: -.04em
  headline:
    fontFamily: Raleway, sans-serif
    fontSize: 2.5rem
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: -.035em
  task-headline:
    fontFamily: Raleway, sans-serif
    fontSize: 44px
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: -.04em
  collection-heading:
    fontFamily: Raleway, sans-serif
    fontSize: 2rem
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: -.025em
  title:
    fontFamily: Raleway, sans-serif
    fontSize: 1.5rem
    fontWeight: 750
    lineHeight: 1.3
  recipe-title:
    fontFamily: Raleway, sans-serif
    fontSize: 1.125rem
    fontWeight: 750
    lineHeight: 1.4
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  reading-body:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: .875rem
    fontWeight: 650
    lineHeight: 1.5
  cooking-title:
    fontFamily: Raleway, sans-serif
    fontSize: 30px
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: -.04em
  cooking-instruction:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: clamp(22px, 2.1vw, 28px)
    fontWeight: 400
    lineHeight: 1.65
rounded:
  control: 8px
  card: 12px
  flat: '0'
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '6': 24px
  '8': 32px
  '12': 48px
  '16': 64px
components:
  button-primary:
    backgroundColor: '{colors.yellow}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 10px 16px
    height: 48px
  button-primary-hover:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.ink}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 10px 16px
    height: 48px
  button-secondary-hover:
    backgroundColor: '{colors.cream}'
    textColor: '{colors.ink}'
  button-quiet:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 10px 16px
    height: 48px
  button-danger:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.error}'
    rounded: '{rounded.control}'
    padding: 10px 16px
    height: 48px
  button-danger-hover:
    backgroundColor: '{colors.danger-tint}'
    textColor: '{colors.error}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 12px 14px
    height: 48px
    typography: '{typography.body}'
  navigation-link:
    textColor: '{colors.ink}'
    rounded: '{rounded.flat}'
    padding: 10px 12px
    height: 48px
    typography: '{typography.label}'
  filter-chip:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 10px 12px
    height: 48px
  recipe-shelf:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.flat}'
  context-workspace:
    backgroundColor: '{colors.cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.card}'
    padding: 24px
---

# Design System: Let Me Cook

## Overview

**Creative North Star: "Market counter"**

Market counter makes food and the next useful action easy to find. Original recipe photographs sit on open shelves; white task canvases meet soft ivory working margins. Sunny and yellow remain the recognizable brand, with self-hosted Raleway headings and system sans for everyday reading and controls.

The system is spacious at the page level and compact where people work. Thin separators connect related sections; rounded photos and bounded working areas identify a useful region without wrapping every section in a card. English copy, complete source content, explicit audio actions and matching same-row panel heights are durable constraints.

This records the authorized replacement world from the corrected source and its design board. The source controls exact values and responsive behavior; board diagrams are illustrative. This document describes the visual system and does not certify production readiness, commercial rights or physical-device audio behavior.

**Key Characteristics:**

- Original food photography and preserved Sunny assets.
- White ground, ivory context areas and Sunny yellow actions.
- Raleway headings with system sans body and native controls.
- Open shelves, continuous workspaces and plain reading documents.
- Equal-height same-row regions; natural-height stacks on small screens.

## Colors

Sunny yellow is warm and decisive against white ground, soft ivory working areas and charcoal text. Frontmatter values are normative; the names below describe their use. Sidecar tonal strips are synthesized OKLCH preview metadata, not additional shipped palette colors.

### Primary

- **Sunny Yellow** (`colors.yellow`): primary action, selected controls and the broad home/dashboard/account brand regions.
- **Golden Hover** (`colors.gold`): primary-action hover and the selected navigation underline.

### Neutral

- **White Surface** (`colors.surface`): page ground, forms and task content.
- **Ivory Workspace** (`colors.cream`): context margins, settings, quiet feedback and the footer.
- **Charcoal Ink** (`colors.ink`): headings, body emphasis and visible focus.
- **Muted Text** (`colors.muted`): descriptions, attribution and supporting labels.
- **Quiet Line** (`colors.line`): separators, field outlines and bounded workspace edges.

### Functional

- **Error Ink** (`colors.error`): shared error text and destructive actions.
- **Danger Line / Danger Tint** (`colors.danger-line`, `colors.danger-tint`): shared destructive outline and hover fill; these are feedback colors, not a second brand accent.

**The Sunny Action Rule.** Use yellow for primary actions and selected controls, with gold on hover. Broad yellow home, dashboard and account brand regions are valid expressions of the same world. Keep ordinary reading on white or ivory.

## Typography

**Display and Heading Font:** self-hosted Raleway with sans-serif fallback. Both variable normal and italic faces use `font-display: swap`.

**Body and Control Font:** the system stack in frontmatter. Everyday copy starts at regular weight; labels and actions use stronger weights to identify function.

### Hierarchy

- **Display:** home hero uses the frontmatter display role, reaching 64px on wide screens; at 1040px it becomes 44px and at 740px it becomes 40px. This is a discovery treatment, not the task-page title.
- **Headline:** common catalog, profile, dashboard and reading headings use 40px, generally weight 750–800 and line-height 1.12–1.2. The frontmatter headline captures the repeated product heading at weight 800 and line-height 1.15; shared page headings use weight 750, line-height 1.2 and tracking -.025em, and reading headings use weight 800, line-height 1.2 and tracking -.025em.
- **Task headline:** kitchen, planner, Sunny and operations use 44px desktop at weight 800. Kitchen/planner/operations pass through 36px at 768px and 32px at 600px; Sunny uses 32px at 600px. Common product headings become 32px at 768px, and information headings at 700px. Public collection headings are a valid 48px desktop / 36px-at-768px exception.
- **Collection heading:** 32px / line-height 1.25 on open shelves. Home becomes 26px at 740px; shared carousel headings become 24px at 600px. Planner results use 32px, then 28px at 768px.
- **Title:** ordinary section headings use 24px, usually weight 750–800 and line-height 1.3–1.35; narrow section headings commonly use 22px. Recipe-shelf titles use the frontmatter recipe-title role; contextual recipe titles elsewhere vary from 20–22px.
- **Body:** 16px with line-height 1.6, using the body role. Descriptions can use 1.65–1.7; legal clauses use the reading-body role and a 75ch maximum measure.
- **Label:** 14px, mixed case, usually weight 600–700. Labels describe a real field or state rather than adding decorative headings.
- **Cooking exceptions:** the recipe is the cooking page's h1 at 30px / line-height 1.3, becoming 26px at 600px. Current source instructions use 22–28px / line-height 1.65, becoming 22px on phones; timer numerals use 36px. These roles keep the working step prominent.

**The Role Before Uniformity Rule.** Use the common scale for new surfaces, and preserve the evidenced route roles below. Do not force every page or recipe title to one size.

## Layout

Content uses a 1200px maximum with desktop gutters of 32px. The shared gutter becomes 24px at 1040px and 20px at 600px. The spacing tokens form the actual 4, 8, 12, 16, 24, 32, 48 and 64px rhythm; most workspace section gaps are 32px on desktop and 24px on narrower screens. Bounded context regions use 24px padding, typically 20px on phones. Specific discovery and account compositions can use 40–48px insets or gaps.

**The Shared Row Rule.** Every visible region paired in the same row stretches to the tallest natural content. Stretch both the wrapper and its visible inner region; never impose a fixed content height or clip content to make the row match.

Grid and flex children use zero minimum width and wrap content. Matching heights apply to meaningful paired regions and repeated items in a row, including open compositions with visible separator edges. Inline control groups, a compact sticky contents list inside a stretched rail and stacked mobile regions retain their useful natural dimensions. Reserve photo aspect ratio while an image loads.

- **Discovery:** home has two equally stretched hero columns, a four-column photo shelf, two columns at 1040px and one at 600px. Home hero and signup regions stack at 740px with prompt before photo. Shared catalog shelves use three columns, two at 900px and one at 600px.
- **Workspaces:** kitchen uses a flexible task canvas beside a 300–360px ivory context margin with a 32px gap; at 1000px the margin becomes 280–320px with a 24px gap, and at 900px it stacks. Sunny uses a 280–340px ingredient margin, then 260–300px at 1000px, and stacks at 800px in request → ingredients → results order. Account/profile/editor sections keep one continuous canvas with separators; auth shows matching brand and form regions on desktop and prioritizes the form at 768px.
- **Planning:** dinner rows combine date, source photo, recipe and swap controls, then progressively wrap at 1000px, 768px and 600px. Groceries occupy their own full-width section. The review-before-applying preview uses an ivory region with a neutral 1px outline, not a highlighted gold frame.
- **Reading:** Terms and Privacy use an unboxed heading and a 220px stretched contents rail beside a plain article with 40px gap. The inner navigation is sticky and scrollable at desktop; at 899px it moves above the document, and at 520px its links use one column. Clauses remain continuous, with light separators and a 75ch measure.
- **Cooking:** the kitchen selector and horizontal workspace navigation are compact. The recipe title, source links and refresh control precede the step canvas. Within the step, progress and explicit guidance controls precede the source instruction; timer suggestions and step actions follow. At 900px the timer margin stacks; at 600px the selector is a single compact row, the recipe title is 26px, refresh is a labeled 44px icon control, and the primary next-step action comes first in the visual button stack.

Breakpoints are component-specific, not a forced single global responsive cutoff. The sidecar records the important source thresholds and their purposes. Keep controls in normal flow and preserve useful order down to a 320px viewport.

## Elevation & Depth

Task, catalog and reading surfaces use tonal layering and thin separators. Photography has a clear crop and quiet corners; open recipe items have no enclosing card border or shadow. True overlays retain the source's soft elevation rather than borrowing that elevation for decoration.

### Shadow Vocabulary

- **Popover:** `0 8px 24px #1E1E1E24` for account, filter and select menus.
- **Photo control:** `0 4px 12px #1E1E1E18` for controls placed over recipe photography.

Dialogs retain their route-local overlay treatments; these are not a new all-purpose card shadow.

**The Flat Task Canvas Rule.** Keep normal task and reading sections flat. Use tonal regions and separators for structure; reserve the existing soft shadows for popovers, dialogs and controls placed over photography.

## Shapes

Controls have gently curved corners using the control radius. Photos and bounded work/context areas use the card radius. Open sections, shelf containers, ordinary document clauses and underline navigation use flat edges. Circular account avatars remain a purpose-specific exception. Borders are generally a quiet 1px line; active navigation uses a 3px bottom line. Do not round an open page section merely because a neighboring photograph has rounded corners.

## Components

### Buttons

Confident native controls share one meaning across all route families. Shared buttons have a minimum 48px height, 8px corners and 10px 16px padding; kitchen/Sunny/planner variants can use 11px 20px and product form actions 12px 18–20px. Height is a minimum, never a cap for wrapped text.

Primary is yellow with gold hover; secondary is white with a quiet outline and ivory hover; shared quiet is transparent and borderless, while task quiet actions are underlined inline links. Danger uses error ink and its functional outline/tint. The home/dashboard prompt submit is an evidenced charcoal-on-yellow-region exception with white text. Busy controls stay in place and disable repeated submission; shared disabled opacity is .55.

**The Action Vocabulary Rule.** Primary actions are yellow, secondary actions have a white surface and quiet border, and quiet actions remain inline. An error-colored outline is the destructive variant. Keep the same meaning across route families.

### Chips

Selected filters are removable 48px controls with 8px corners, quiet outlines and mixed-case 14px labels; hover uses yellow. Planner dietary choices are 44px checkbox controls that change from white to yellow when selected. Functional state text can be unboxed; don't recreate decorative badge rows around ordinary conditions.

### Cards / Containers

Recipe shelves are open links: a 4:3 original image with 12px corners, followed by 16px top spacing for title and source metadata. Their text region flexes so metadata/actions can align within a row. Context areas use ivory, 12px corners, 24px desktop/20px phone padding and quiet boundaries. Normal task sections and legal clauses stay unboxed. Loading and unavailable images keep their reserved photo space with truthful text.

### Inputs / Fields

Native labeled fields use white, a quiet 1px outline, 8px corners, 16px text and minimum 48px height. Common form padding is 12px 14px; workspace fields use 10px 12px. Textareas grow vertically. Keep labels, field help and real error messages associated with their control. React Select menus use the same white/ivory/yellow state colors and render through a portal so grids cannot clip them.

### Navigation

The white shell uses a compact Sunny brand, links and controls in one row with a quiet bottom separator. Links have a minimum 48px target, 14px weight-650 text and a 3px gold active underline. At 1040px the menu toggles a new row in normal flow, using two columns, then one column at 600px. Workspace tabs use the same underline grammar; selected options and pagination can use a yellow fill. Icon controls are 44px with an accessible name.

### Cooking Step and Document Contents

Cooking is a real working canvas. Guidance is an explicit start/play/pause/replay/stop control group immediately before the current source instruction; nothing autoplays. The secondary timer margin matches the step region when side-by-side and grows naturally after stacking. Source steps and conversation use native disclosures below the active work.

Legal reading is a plain article beside a stretched rail, with compact sticky contents inside it. On narrow screens the disclosure precedes the article; keep original clauses intact and let long prose use the page scroll.

### Focus and Motion

The default focus ring is 3px charcoal with 4px offset; shared native and product controls can use the evidenced 3px offset. Preserve focus on links, buttons, fields, summary controls and icon actions. A skip link appears on focus and reaches the main content.

Shared color/border transitions use `180ms ease`; workspace button fills use 150ms. Do not add decorative movement to operating or reading surfaces. The global reduced-motion rule sets scrolling to auto, animation and transition duration to .01ms and iteration count to one; route-local spinners also stop.

## Do's and Don'ts

### Do:

- **Do** preserve Sunny, English copy, original recipe photos and visible source attribution.
- **Do** stretch same-row outer regions and their visible inner surfaces; let stacked regions take natural height.
- **Do** use the shared action vocabulary and keep the primary action next to its task or directly after its fields.
- **Do** preserve complete titles, instructions and legal clauses with wrapping and natural page scroll.
- **Do** retain visible focus, native labels, explicit audio controls and reduced-motion behavior.

### Don't:

- **Don't** introduce a universal page-heading size that erases the documented route exceptions.
- **Don't** replace original food photography or Sunny with synthetic brand substitutes.
- **Don't** turn every section into an enclosing card or add floating decorative shadows to normal workspaces.
- **Don't** force height equality after columns stack, or use fixed heights and clipping to achieve it.
- **Don't** hide real loading, empty, retry or busy states behind invented testimonials, proof or production claims.

**Not canonized:** inherited rating-star and external-link-arrow text glyphs, unused legacy kicker declarations and isolated helper error-color literals are present in source but are not a reusable icon, typography or palette rule. This documentation pass does not repair UI code; use proper SVG icons and the normative tokens when extending surfaces.
