# Flova-Clone Roadmap (Decomposition)

> This is a **decomposition document**, not a spec. It maps the full effort into
> phases; each phase will get its own design spec + implementation plan before
> any code is written. The roadmap is fixed; phases may be re-scoped after each
> design pass.

## Goal

Bring the flova.ai feature set into this local Electron app, with three core
substitutions appropriate for a local-first product:

| Flova subsystem | Substitution in this app |
|---|---|
| Multi-model cloud generation (Sora, Kling, Veo, Nano Banana) | **Distributed local ComfyUI across multiple workstations** |
| FlovaTV / community hub | **Out of scope** — handled by a separate project |
| Skills (user-trained workflow personalization) | **Browse + import community-shared ComfyUI workflows** |
| Learn / tutorials | **In-app "how to use this app" docs** |

## Already shipped (Phase 0)

Commit `487012b` — gallery, single-workstation GenerateView with live polling,
ComfyUI queue + status IPC, top-nav. Foundation for everything below.

## Phases

| # | Phase | Status | Depends on | Notes |
|---|---|---|---|---|
| 0 | Foundation (Gallery + Generate + ComfyUI IPC) | ✅ Shipped | — | `487012b` |
| 1 | Workstation Pool & Scheduler | 🟡 Designing | 0 | Architectural keystone. Three scheduling modes: LAN pool, per-model, manual. |
| 2 | Projects | ⬜ Planned | 1 | Organize Gallery entries into projects. |
| 3 | Characters library | ⬜ Planned | 1 | Reusable subjects + reference images. |
| 4 | Conversational generator + storyboard | ⬜ Planned | 1, 2 | Ollama chat → script → shot list → scheduler. |
| 5 | 360° Character consistency | ⬜ Planned | 3 | IPAdapter / InstantID workflows; multi-angle batch. |
| 6 | Skills marketplace | ⬜ Planned | 1 | Browse + import community ComfyUI workflows. |
| 7 | Timeline editor | ⬜ Planned | 1 | Multi-track video composition. Largest investment; only if video is endgame. |
| 8 | In-app docs | ⬜ Planned | — | "How to use this app" view, tooltips, onboarding. |

## Build order

**1 → 2 → 3 → 6 → 4 → 5 → 8 → 7**

Reasoning: foundation → organization → reusable assets → community workflows
(experiment cheaply with new capabilities) → conversational layer ties it
together → identity locking refines characters → docs once UX is stable →
timeline last as the biggest engineering investment.

## Process

For each phase:

1. Brainstorm (this skill) → design spec at `docs/superpowers/specs/YYYY-MM-DD-phase-N-<name>-design.md`
2. Writing-plans skill → implementation plan
3. Build → review → commit
4. Update this roadmap with status

## Out of scope

- Cloud-only generation models (Sora, Kling, Veo) — replaced by local ComfyUI pool
- Public community hub / browsing others' creations — separate project
- Hosted accounts / billing / multi-user
- Mobile or web client — desktop Electron only
