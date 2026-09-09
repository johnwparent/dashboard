#!/bin/bash
# Run this script to refresh all data for today

cd $(dirname "$0")

exec &> >(tee ../LAST_UPDATE.log)

export GITHUB_DATA=../../explore/github-data
DATELOG=../LAST_UPDATE.txt

# On exit
function finish {
    # Log end time
    echo -e "END\t$(date -u)" >> $DATELOG
}
trap finish EXIT

# Stop and Log for failed scripts
function errorCheck() {
    if [ $ret -ne 0 ]; then
        echo "FAILED - $1"
        echo -e "FAILED\t$1" >> $DATELOG
        exit 1
    fi
}

# Log, but don't stop the update, for scripts that fail safely on their own
# (they refuse to overwrite existing data when every query in the run failed,
# e.g. a transient GitHub API hiccup) -- there's no data-loss risk in letting
# the rest of the pipeline continue.
function warnCheck() {
    if [ $ret -ne 0 ]; then
        echo "SOFT-FAIL - $1 (kept previous data, continuing)"
        echo -e "SOFT-FAIL\t$1" >> $DATELOG
    fi
}

# Basic script run procedure
function runScript() {
    echo "Run - $1"
    python -u $1
    ret=$?
    errorCheck "$1"
}

# Same, but a failure doesn't abort the rest of the update. Only use this for
# scripts that already guard against overwriting good data with a failed run.
function runScriptSoft() {
    echo "Run - $1"
    python -u $1
    ret=$?
    warnCheck "$1"
}

# Basic script run procedure but make it Spack
function runSpackScript() {
    echo "Run - $1"
    spack -d python "$@"
    ret=$?
    errorCheck "$1"
}

# Check Python requirements
runScript python_check.py


echo "RUNNING UPDATE SCRIPT"

# Log start time
echo -e "$(date -u '+%F-%H')" > $DATELOG
echo -e "START\t$(date -u)" >> $DATELOG


# RUN THIS FIRST
runScript cleanup_inputs.py


# --- BASIC DATA ---
# Required before any other repo scripts (output used as repo list).
# Soft: on a total failure it keeps yesterday's repo list rather than
# emptying it, so later scripts still have something to iterate over.
runScriptSoft get_repos_info.py
# Required before any other member scripts (output used as member list)
runScriptSoft get_internal_members.py


# --- EXTERNAL V INTERNAL ---
runScriptSoft get_members_extrepos.py
runScriptSoft get_repos_users.py


# --- ADDITIONAL REPO DETAILS ---
runScriptSoft get_repos_languages.py
runScriptSoft get_repos_topics.py
# These two hit GitHub's per-repo /stats endpoints, which can 202 (stats not
# yet cached) for every repo at once -- a transient, not code, problem.
runScriptSoft get_repos_activitycommits.py
runScriptSoft get_repos_activitylines.py
runScriptSoft get_repos_dependencies.py
runScriptSoft get_dependency_info.py


# --- HISTORY FOR ALL TIME ---
runScriptSoft get_repos_starhistory.py
runScriptSoft get_repos_releases.py
runScriptSoft get_repos_creationhistory.py

# --- SPACK DEPENDENCY INFO ---
runSpackScript get_spack_dependencies.py --input-list ../input_lists.json

# RUN THIS LAST
runScript build_yearlist.py  # Used in case of long term cumulative data

runScript gather_repo_metadata.py  # Generate simplified metadata file


echo "UPDATE COMPLETE"
