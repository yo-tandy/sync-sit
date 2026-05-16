#!/usr/bin/env bash
#
# install-sync-study-skills.sh
#
# Installs every Claude Code skill referenced by docs/sync-study-project-plan.md.
#
# Skills are installed at the project/user level — they become visible to every
# agent in the team. The per-agent "Role / Skills to Invoke" tables in §8 of
# the plan tell each agent which subset to actually invoke.
#
# Usage:
#   bash scripts/install-sync-study-skills.sh                    # install everything (project-level)
#   bash scripts/install-sync-study-skills.sh --check            # only print what would be installed
#   bash scripts/install-sync-study-skills.sh --verify           # compare installed vs catalog (no install)
#   bash scripts/install-sync-study-skills.sh --group workflow   # install one group
#   bash scripts/install-sync-study-skills.sh --global           # install at user level (~/.claude)
#
# Groups: workflow, typescript, frontend, firebase, testing, qa, security
#
# Non-interactive: passes `-y` (skip skills-CLI prompts) and `-a claude-code`
# (skip the agent-picker prompt) on every install. The very first run still
# triggers npx's own "Need to install the following packages: skills... Ok?"
# prompt — we suppress that with `npx --yes`.
#
# Requires: npx (Node 18+) and network access to github.com.

set -euo pipefail

DRY_RUN=0
VERIFY=0
GROUP=""
SCOPE_FLAG=""   # empty => project-level (skills CLI default with -y); -g for global

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--dry-run) DRY_RUN=1 ;;
    --verify) VERIFY=1 ;;
    --group) GROUP="${2:-}"; shift ;;
    --global) SCOPE_FLAG="-g" ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# ---- skill catalog -----------------------------------------------------------
# Format: GROUP|REPO|SKILL
#
# Mirrors §8 "Project-Wide Skill Installation" in docs/sync-study-project-plan.md.
# Keep this list in sync with that section.

SKILLS=(
  # Workflow & orchestration (used by every agent)
  "workflow|obra/superpowers|writing-plans"
  "workflow|obra/superpowers|executing-plans"
  "workflow|obra/superpowers|subagent-driven-development"
  "workflow|obra/superpowers|dispatching-parallel-agents"
  "workflow|obra/superpowers|test-driven-development"
  "workflow|obra/superpowers|requesting-code-review"
  "workflow|obra/superpowers|receiving-code-review"
  "workflow|mattpocock/skills|improve-codebase-architecture"
  "workflow|wshobson/agents|monorepo-management"

  # TypeScript & refactor (Agents 1, 4)
  "typescript|wshobson/agents|typescript-advanced-types"
  "typescript|mcollina/skills|typescript-magician"
  "typescript|pproenca/dot-skills|zod"
  "typescript|github/awesome-copilot|refactor-plan"

  # Frontend (Agents 2, 5)
  "frontend|vercel-labs/agent-skills|vercel-react-best-practices"
  "frontend|wshobson/agents|tailwind-design-system"
  "frontend|wshobson/agents|design-system-patterns"
  "frontend|wshobson/agents|react-state-management"
  "frontend|addyosmani/web-quality-skills|accessibility"
  "frontend|antfu/skills|vite"
  "frontend|sickn33/antigravity-awesome-skills|i18n-localization"

  # Firebase & backend (Agents 3, 4, 5, 6)
  "firebase|firebase/agent-skills|firebase-basics"
  "firebase|firebase/agent-skills|firebase-auth-basics"
  "firebase|firebase/agent-skills|firebase-firestore"
  "firebase|firebase/agent-skills|firebase-hosting-basics"
  "firebase|firebase/agent-skills|firebase-app-hosting-basics"
  "firebase|wshobson/agents|nodejs-backend-patterns"

  # Testing & review (Agent 7, plus all agents post-change)
  "testing|antfu/skills|vitest"
  "testing|wshobson/agents|javascript-testing-patterns"
  "testing|wshobson/agents|code-review-excellence"
  "testing|dotneet/claude-code-marketplace|typescript-react-reviewer"

  # Functional QA (Agent 8 — Tester)
  "qa|wshobson/agents|e2e-testing-patterns"
  "qa|softaworks/agent-toolkit|qa-test-planner"

  # Security & GDPR (Agent 9 — Security Specialist)
  "security|firebase/agent-skills|firebase-security-rules-auditor"
  "security|wshobson/agents|gdpr-data-handling"
  "security|sickn33/antigravity-awesome-skills|api-security-best-practices"
  "security|wshobson/agents|secrets-management"
  "security|wshobson/agents|threat-mitigation-mapping"
  "security|wshobson/agents|security-requirement-extraction"
)

# ---- verify ------------------------------------------------------------------

if [[ $VERIFY -eq 1 ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "verify requires python3 in PATH" >&2
    exit 2
  fi

  ls_scope_flag=""
  scope_label="project (cwd: $(pwd))"
  if [[ -n "$SCOPE_FLAG" ]]; then
    ls_scope_flag="-g"
    scope_label="global (~/.claude/skills)"
  fi
  echo "Verifying scope: ${scope_label}"
  echo "Querying installed skills (this may clone repos on first run)..."
  raw_json="$(npx --yes skills ls --json --agent claude-code $ls_scope_flag 2>/dev/null || true)"

  # Filter catalog by --group if set
  expected=()
  for entry in "${SKILLS[@]}"; do
    IFS='|' read -r grp _ skill <<< "$entry"
    if [[ -n "$GROUP" && "$GROUP" != "$grp" ]]; then continue; fi
    expected+=("${grp}:${skill}")
  done

  python3 - "$raw_json" "${expected[@]}" <<'PY'
import json, sys

raw = sys.argv[1]
expected = sys.argv[2:]

try:
    installed = {s.get("name") for s in json.loads(raw) if isinstance(s, dict)}
except Exception:
    installed = set()

expected_pairs = [e.split(":", 1) for e in expected]
expected_names = {name for _, name in expected_pairs}

missing = [(g, n) for g, n in expected_pairs if n not in installed]
extra = sorted(installed - expected_names)

print()
print(f"Installed skills (claude-code agent): {len(installed)}")
print(f"Catalog skills expected:              {len(expected_names)}")
print(f"Missing:                              {len(missing)}")
print(f"Extra (not in catalog):               {len(extra)}")
print("-" * 60)

if missing:
    print("MISSING — install these:")
    for grp, name in missing:
        print(f"  [{grp}] {name}")
    print()

if extra:
    print("Extra installed (informational, not an error):")
    for name in extra:
        print(f"  {name}")
    print()

sys.exit(1 if missing else 0)
PY
  exit $?
fi

# ---- run ---------------------------------------------------------------------

total=0
installed=0
skipped=0
failed=()

for entry in "${SKILLS[@]}"; do
  IFS='|' read -r grp repo skill <<< "$entry"

  if [[ -n "$GROUP" && "$GROUP" != "$grp" ]]; then
    continue
  fi

  total=$((total + 1))
  # -y: skip skills-CLI scope prompt
  # -a claude-code: skip the agent-picker prompt
  # --yes (on npx): skip the one-time package-install prompt
  cmd=(npx --yes skills add "https://github.com/${repo}" \
       --skill "${skill}" \
       --agent claude-code \
       -y)
  if [[ -n "$SCOPE_FLAG" ]]; then
    cmd+=("$SCOPE_FLAG")
  fi

  printf '[%s] %-50s  (%s)\n' "$grp" "$skill" "$repo"

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '       would run: %s\n' "${cmd[*]}"
    skipped=$((skipped + 1))
    continue
  fi

  if "${cmd[@]}"; then
    installed=$((installed + 1))
  else
    failed+=("${repo}/${skill}")
  fi
done

echo
echo "----------------------------------------"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run: ${total} skills would be installed."
else
  echo "Installed: ${installed}/${total}"
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "Failed: ${#failed[@]}"
    printf '  - %s\n' "${failed[@]}"
    exit 1
  fi
fi
echo "----------------------------------------"
