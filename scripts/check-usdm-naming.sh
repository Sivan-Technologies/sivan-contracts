#!/usr/bin/env bash
#
# USDm naming guard. Portable across every Sivan repository.
#
# Mento rebranded cUSD to USDm (Mento Dollar). The contract addresses and the
# 18 decimal standard are unchanged, but the token itself now reports
# symbol()="USDm" and name()="Mento Dollar" on Celo Mainnet and Celo Sepolia.
# Anything still printing "cUSD" or "Celo Dollar" does not merely look dated,
# it contradicts the contract it claims to describe.
#
# Run from a repository root:
#     ./check-usdm-naming.sh
#
# Exit 0 clean, 1 on a violation. Wire it into CI as its own job.
#
# WHAT IS DELIBERATELY ALLOWED
#
# 1. "formerly cUSD"      first-mention historical notes in documentation
# 2. lines marked as a retired/legacy spelling, which are INBOUND aliases:
#    code that still ACCEPTS the old value from clients mid-migration and
#    folds it to the new one. Removing those would break live integrations,
#    and in one case would have silently settled in the wrong asset.
#
# The distinction that matters: nothing should EMIT cUSD. Accepting it on the
# way in, with a comment saying so, is input tolerance rather than naming.

set -uo pipefail

EXCLUDE_DIRS='{node_modules,.git,dist,build,out,.next,coverage,artifacts,cache,lib,forge-out,deployments,.turbo,.svelte-kit}'
fail=0

# ── 1. The retired name has no legitimate use anywhere ──────────────────
#
# Excluding this script and any CI workflow, since both must name the retired
# terms in order to forbid them. Without that the guard fails on every run
# including a clean tree, and a check that is always red gets ignored and then
# disabled. This is not hypothetical: the first version of this guard did
# exactly that.
if eval grep -rnI "'Celo Dollar'" \
     --exclude-dir=$EXCLUDE_DIRS \
     --exclude="check-usdm-naming.sh" \
     --exclude="ci.yml" \
     . 2>/dev/null; then
  echo "::error::'Celo Dollar' is the retired name. The chain reports 'Mento Dollar'."
  fail=1
fi

# ── 2. Bare cUSD, in any casing ─────────────────────────────────────────
# Word boundary required. A bare substring search matches identifiers that
# merely CONTAIN the letters, such as netMarginBeforeCacUsd and bscUsdcFloor,
# and a guard that cries wolf on unrelated code gets switched off. -w is not
# enough on its own because cUSD_MAINNET and CUSD_CELO must still be caught,
# so the boundary is expressed explicitly: not preceded by a letter, and not
# followed by a letter other than the underscore-joined suffixes.
hits=$(eval grep -rnIiE "'(^|[^a-zA-Z])c_?usd([^a-zA-Z]|$)'" \
         --exclude-dir=$EXCLUDE_DIRS \
         --exclude=".env" \
         --exclude="check-usdm-naming.sh" \
         --exclude="ci.yml" \
         --exclude="*.patch" --exclude="*.pdf" --exclude="*.lock" \
         . 2>/dev/null \
       | grep -v "formerly cUSD" \
       | grep -viE "retired|legacy|mid-migration|pre-rebrand|Fold the|folded to" \
       || true)

if [ -n "$hits" ]; then
  echo "$hits"
  echo "::error::bare cUSD found. Use USDm."
  echo "  Documentation: 'USDm (Mento Dollar, formerly cUSD)' on first mention."
  echo "  Inbound aliases: keep, but comment the line as a retired spelling."
  fail=1
fi

# ── 3. The dead USDC address must never reappear ────────────────────────
#
# 0xcebA97Fcedaa310E7D988936b9741FA007a9C05c was published in three developer
# documents as Celo mainnet USDC. It has codesize 0: not a contract at all. Its
# first six characters match the real address, so it survives a glance, and one
# instance sat in a copy-pasteable snippet. Anyone following those docs sends
# USDC to an address with no code and the funds are unrecoverable.
if eval grep -rnI "0xcebA97Fcedaa310E7D988936b9741FA007a9C05c" \
     --exclude-dir=$EXCLUDE_DIRS \
     --exclude="check-usdm-naming.sh" \
     --exclude="*.patch" \
     . 2>/dev/null; then
  echo "::error::that address is NOT a contract (codesize 0)."
  echo "  Real Celo mainnet USDC: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "naming clean: USDm everywhere, no retired names, no dead addresses"
fi
exit "$fail"
