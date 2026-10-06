# Code typography settings slice

Current backups use version 6 only. Earlier backup formats and migrations recorded here are
superseded by the [stateless project cutover](stateless-project-access-plan.md); preferences retain
their current standalone storage formats.

Status: implemented and committed. Theme controls are complete in the
[theme settings slice](theme-settings-slice-proposal.md).

## User flow and smallest slice

Settings is reachable from the global menu, including before a project is open. It has its own URL
and shows typography controls with a live code preview alongside Appearance and Install & local
data. Back returns to the previous work. Choosing a font size or family applies immediately to diff
rows, Files code, search excerpts, and feedback source excerpts. It does not change file names,
controls, or other interface text.

The first choices are 11–20 px in 1 px steps, and two local monospace stacks: System mono (the
existing default) and Courier. No font download or server endpoint is needed. Reset restores 12 px
System mono.

The later [Google code fonts follow-up](google-code-fonts-followup.md) adds 20 optional web fonts
while keeping both original local choices and the same storage format.

## Data and boundaries

The frontend saves `{version: 1, fontSize, fontFamily}` under one versioned `localStorage` key for
this browser origin. A boundary parser accepts only integer sizes in range and known font IDs (the
two local choices plus the 20 Google families). Missing, malformed, or future versions fall back to
the defaults. Storage failure leaves the current page usable. Changes in another tab update the
current tab.

This slice introduced version 2 backups with required typography settings. The later
[theme settings slice](theme-settings-slice-proposal.md) introduced version 3 exports and earlier
imports; those formats have since been retired. Invalid typography rejects the import before any
writes. The server continues to return semantic syntax roles; CSS design tokens and frontend
settings supply the visual style.

## Edge cases and checks

- The Settings screen works without a selected project and on a narrow phone.
- Switching projects or files while Settings is open closes Settings and follows the chosen
  destination.
- Code at 20 px remains contained by its wrap or horizontal code pane; it does not widen the page.
- Reload, a second tab, backup export/import, and legacy backup import preserve the intended choice.
- Browser checks cover the interaction and persistence; four viewport screenshots cover phone, both
  tablet orientations, and desktop. Real device reading comfort remains for the maintainer to judge.
