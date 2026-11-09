# Branching

Two long-lived branches, short-lived topic branches, and automatic cleanup.

| Branch | Is | Deploys to | Receives | Merge method |
|---|---|---|---|---|
| `main` | what runs in **production**; every commit on it was released | production | a release pull request from `develop`, or a `hotfix/*` | **merge commit** |
| `develop` | the integration branch and the **default branch**; what stage (QA) runs | stage | every feature, fix, chore and Dependabot pull request | **squash** (a merge commit only for the hotfix back-merge) |
| `feat/*` `fix/*` `chore/*` `docs/*` `test/*` `refactor/*` | one change, from `develop` | | | deleted automatically after the merge |
| `hotfix/*` | an urgent production fix, from `main` | | | |

Both long-lived branches are protected by a ruleset (`.github/rulesets/main.json`, `develop.json`; see [GOVERNANCE.md](GOVERNANCE.md#branch-protection)):
a pull request, every CI and security job green on a branch that is up to date, CodeQL clean, resolved conversations, no deletion, no force push.

## A change

1. `git switch develop && git pull`, then `git switch -c fix/short-name`. One concern per branch, branched from `develop`. A pull request
   never targets another topic branch (it would land in a branch that is later deleted).
2. Open the pull request into `develop` (the default, so it is the default target). CI runs. Squash-merge it; the branch is deleted by GitHub.
3. Stage runs `develop`. QA signs off there.

## A release

1. Open a pull request **from `develop` into `main`** titled `Release vX.Y.Z`. CI runs on it.
2. **Merge it with a merge commit, never squash.** A squash gives `main` a commit `develop` does not have, the two diverge, and every release then
   needs a back-merge. The `main` ruleset allows only merge commits for this reason.
3. Deploy `main` to production. Tag the merge commit `vX.Y.Z`.
4. Do **not** delete `develop` (GitHub's automatic cleanup skips the default branch, and the ruleset forbids deleting it).

## A hotfix

1. `git switch main && git pull`, then `git switch -c hotfix/short-name`. Fix, open the pull request into `main` (merge commit), deploy, tag.
2. Back-merge into `develop` the same day: a pull request from `main` into `develop`, merged with a **merge commit** (the one change `develop`
   takes that way; its ruleset allows both methods so this is possible, and topic branches still squash by convention). Until it lands,
   the next release would remove the fix.

## What follows from the two branches

- **Dependabot** opens every pull request against `develop` (`.github/dependabot.yml`, `target-branch`), so dependency updates reach production
  with the next release like any other change.
- **The nightly Operations check** compares stage's live schema with `develop` and production's with `main` (`ops.yml`), because a release
  moves migrations from one to the other. Scheduled workflows run from the default branch, so the branch is named explicitly there.
- **Migrations** are applied to stage from `develop` and to production from `main`. A migration is never edited once it has been applied anywhere.
- **Stage** is the only place `develop` is deployed; `main` is never deployed to stage by itself, so stage can be ahead of production, never behind.

## Keeping the branch list short

- GitHub deletes a pull request's branch when it is merged (repository setting *Automatically delete head branches*).
- A branch with no pull request and no push for 30 days is a question: land it or delete it. Closed pull requests keep their commits at
  `refs/pull/<n>/head`, so deleting a closed pull request's branch loses nothing.
- Do not add `staging`, `qa`, `release` or `production` branches: those are environments (GitHub Environments `stage` and `production`), not branches.

## One-time switch (done once, from a machine with `gh`)

```bash
git push origin main:develop                                           # develop starts as main
for name in main develop; do                                           # apply both rulesets (create develop's, update main's)
  id=$(gh api repos/abushanisro/emithran/rulesets -q ".[] | select(.name==\"$name\") | .id")
  if [ -n "$id" ]; then gh api -X PUT repos/abushanisro/emithran/rulesets/$id --input .github/rulesets/$name.json
  else gh api -X POST repos/abushanisro/emithran/rulesets --input .github/rulesets/$name.json; fi
done
gh repo edit abushanisro/emithran --default-branch develop             # day-to-day pull requests target develop
gh api -X PATCH repos/abushanisro/emithran -f delete_branch_on_merge=true
```

Apply `develop.json` before changing the default branch, so `develop` is never unprotected. In Vercel, keep the production branch `main`.
