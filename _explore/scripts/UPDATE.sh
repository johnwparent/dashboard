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

# Stop and log for a hard-failed script
function errorCheck() {
    if [ $ret -ne 0 ]; then
        echo "FAILED - $1"
        echo -e "FAILED\t$1" >> $DATELOG
        exit 1
    fi
}

# Log, but don't stop the update, for a soft-failed script -- one that fails
# safely on its own (it refuses to overwrite existing data when every query
# in the run failed, e.g. a transient GitHub API hiccup). There's no
# data-loss risk in letting the rest of the pipeline continue.
function warnCheck() {
    if [ $ret -ne 0 ]; then
        echo "SOFT-FAIL - $1 (kept previous data, continuing)"
        echo -e "SOFT-FAIL\t$1" >> $DATELOG
    fi
}

# Run one collection script.
#   --soft   a failure doesn't abort the rest of the update. Only use this
#            for scripts that already guard against overwriting good data
#            with a failed run.
#   --spack  run under `spack python` instead of the system interpreter.
# Flags, if any, must come before the script name.
function runScript() {
    local soft=0 spack=0
    while [ "$1" = "--soft" ] || [ "$1" = "--spack" ]; do
        case "$1" in
            --soft) soft=1 ;;
            --spack) spack=1 ;;
        esac
        shift
    done
    local script="$1"

    echo "Run - $script"
    if [ "$spack" -eq 1 ]; then
        spack -d python "$@"
    else
        python -u "$@"
    fi
    ret=$?

    if [ "$soft" -eq 1 ]; then
        warnCheck "$script"
    else
        errorCheck "$script"
    fi
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
runScript --soft get_repos_info.py
# Required before any other member scripts (output used as member list)
runScript --soft get_internal_members.py


# --- EXTERNAL V INTERNAL ---
runScript --soft get_members_extrepos.py
runScript --soft get_repos_users.py


# --- ADDITIONAL REPO DETAILS ---
runScript --soft get_repos_languages.py
runScript --soft get_repos_topics.py
# These two hit GitHub's per-repo /stats endpoints, which can 202 (stats not
# yet cached) for every repo at once -- a transient, not code, problem.
runScript --soft get_repos_activitycommits.py
runScript --soft get_repos_activitylines.py
runScript --soft get_repos_dependencies.py
runScript --soft get_dependency_info.py


# --- HISTORY FOR ALL TIME ---
runScript --soft get_repos_starhistory.py
runScript --soft get_repos_releases.py
runScript --soft get_repos_creationhistory.py

# --- SPACK DEPENDENCY INFO ---
runScript --spack get_spack_dependencies.py --input-list ../input_lists.json

# RUN THIS LAST
runScript build_yearlist.py  # Used in case of long term cumulative data

runScript gather_repo_metadata.py  # Generate simplified metadata file


echo "UPDATE COMPLETE"
