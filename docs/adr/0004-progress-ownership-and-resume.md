# ADR 0004: Progress ownership and resume precedence

- Status: accepted
- Date: 2026-10-25

## Decision
- `ProgressRepository` is the only writer of server progress (E9) and of the local Continue history, and the only reader of `timeCode`.
- The resume point is the **local position when a local entry exists**, otherwise the server `timeCode`. The server value has no timestamp, so "newest wins" cannot be computed.
- Positions are integer seconds. "Finished" means ≥ 95 % watched or < 30 s left.

## Consequences
If a video was continued on the website, the TV may offer an older position. «С начала» and seeking remain available. The source is AD-10 in the architecture spine and FR-43/44/49 in the PRD.
