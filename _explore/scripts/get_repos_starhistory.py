import os
import sys
import requests
from gh_collector import gh_data_dir, load_data, load_repo_list
from datetime import date, timedelta

ghDataDir = gh_data_dir()
datfilepath = ghDataDir / "intRepos_StarHistory.json"

repolist = load_repo_list(ghDataDir)
dataCollector = load_data(datfilepath)

# GraphQL's stargazers connection is forbidden for the default Actions
# token on repos outside this one (see get_repos_info.py). The REST
# stargazers endpoint isn't subject to that restriction, and with this
# media type also returns each star's timestamp.
headers = {"Accept": "application/vnd.github.star+json"}
api_token = os.environ.get("GITHUB_API_TOKEN")
if api_token:
    headers["Authorization"] = "token %s" % api_token

print("Gathering data across multiple paginated queries...")
failed = 0
for repo in repolist:
    print("\n'%s'" % (repo))

    try:
        starred_ats = []
        page = 1
        while True:
            resp = requests.get(
                "https://api.github.com/repos/%s/stargazers" % repo,
                headers=headers,
                params={"per_page": 100, "page": page},
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            starred_ats.extend(item["starred_at"] for item in batch)
            if len(batch) < 100:
                break
            page += 1
    except Exception as error:
        print("Warning: Could not complete '%s'" % (repo))
        print(error)
        failed += 1
        continue

    dataCollector.data["data"][repo] = {
        "stargazers": {"edges": [{"starredAt": s} for s in starred_ats]}
    }

    print("'%s' Done!" % (repo))

print("\nCollective data gathering complete!")

if repolist and failed == len(repolist):
    sys.exit("All queries failed; refusing to overwrite data")

if failed == 0:
    print("Removing data for repos no longer in the list...")
    for repo in list(dataCollector.data["data"].keys()):
        if repo not in repolist:
            dataCollector.data["data"].pop(repo)
            print("Removed '%s'" % repo)


def next_weekday(d, weekday):
    days_ahead = weekday - d.weekday()
    if days_ahead <= 0:
        days_ahead += 7
    return d + timedelta(days_ahead)


def toDate(isoStr):
    return next_weekday(date.fromisoformat(isoStr["starredAt"].split("T")[0]), 0)


for repo in dataCollector.data["data"]:
    entry = dataCollector.data["data"][repo]
    if not isinstance(entry, dict) or "stargazers" not in entry:
        continue  # already transformed on a prior run; this repo failed this run
    dateRange = list(
        map(toDate, entry["stargazers"]["edges"])
    )
    dateList = []
    dateElement = {"date": None, "value": None}
    for dateEntry in dateRange:
        if dateElement["date"] is None:
            dateElement["date"] = dateEntry.isoformat()
            dateElement["value"] = 1
        elif dateElement["date"] == dateEntry.isoformat():
            dateElement["value"] += 1
        else:
            dateList.append(dateElement.copy())
            dateElement["date"] = dateEntry.isoformat()
            dateElement["value"] = 1
    dataCollector.data["data"][repo] = dateList

dataCollector.fileSave(newline="\n")

print("\nDone!\n")
