from scraper.github import queryManager as qm
import os
from os import environ as env
import json
import requests
import sys
from urllib.parse import quote as urlquote

ghDataDir = env.get("GITHUB_DATA", "../github-data")
datfilepath = "%s/intReposInfo.json" % ghDataDir
cdash_data_path = os.path.normpath(os.path.join(ghDataDir, "..", "cass_project_data"))
queryPath = "../queries/org-Repos-Info.gql"
queryPathInd = "../queries/repo-Info.gql"

# Initialize data collector (single file for all repo types)
dataCollector = qm.DataManager(datfilepath, False)
dataCollector.data = {"data": {}}

# setup cdash repo context
cdash_mapping = {}
with open(os.path.join(cdash_data_path, "cass_member_cdashes.csv")) as f:
    for line in f.readlines():
        repo, cdash_url = line.strip("\n").split(",")
        cdash_mapping[repo] = cdash_url

# Read input lists of organizations and independent repos of interest
inputLists = qm.DataManager("../input_lists.json", True)
for hostUrl, hostInfo in inputLists.data.items():
    repoType = hostInfo["repoType"]
    if repoType == "bitbucket":
        print("%s: %s support not yet enabled, skipping for now" % (hostUrl, repoType))
        continue
    if repoType == "gitlab":
        # Handle GitLab repos via REST API
        print("%s: Gathering GitLab repo info..." % hostUrl)
        apiToken = env.get(hostInfo.get("apiEnvKey", ""), "")
        headers = {}
        if apiToken:
            headers["PRIVATE-TOKEN"] = apiToken
        repolist = hostInfo.get("repos", []) + hostInfo.get("extraRepos", [])
        for repo in repolist:
            print("\n'%s'" % repo)
            try:
                apiUrl = "%s/api/v4/projects/%s" % (hostUrl, urlquote(repo, safe=""))
                resp = requests.get(apiUrl, headers=headers, timeout=30)
                resp.raise_for_status()
                proj = resp.json()

                # Map GitLab API fields to the same format as GitHub data
                info = {}
                info["createdAt"] = proj.get("created_at")
                info["defaultBranchRef"] = {"name": proj.get("default_branch")}
                info["description"] = proj.get("description", "")
                info["forks"] = {"totalCount": proj.get("forks_count", 0)}
                info["homepageUrl"] = proj.get("web_url")
                info["languages"] = {"totalCount": 0}
                info["licenseInfo"] = None
                if proj.get("license"):
                    info["licenseInfo"] = {
                        "name": proj["license"].get("name"),
                        "spdxId": proj["license"].get("key"),
                    }
                info["name"] = proj.get("name", "")
                info["nameWithOwner"] = proj.get("path_with_namespace", repo)
                info["owner"] = proj.get("namespace", {}).get("full_path", "")
                info["parent"] = None
                info["primaryLanguage"] = None
                info["url"] = proj.get("web_url", "%s/%s" % (hostUrl, repo))

                # Fetch languages
                try:
                    langResp = requests.get(
                        "%s/api/v4/projects/%s/languages" % (hostUrl, urlquote(repo, safe="")),
                        headers=headers, timeout=30
                    )
                    if langResp.status_code == 200:
                        languages = langResp.json()
                        info["languages"]["totalCount"] = len(languages)
                        if languages:
                            info["primaryLanguage"] = {"name": max(languages, key=languages.get)}
                except Exception:
                    pass

                repoKey = info["nameWithOwner"]
                dataCollector.data["data"][repoKey] = info
                print("'%s' Done!" % repo)
            except Exception as error:
                print("Warning: Could not complete '%s'" % repo)
                print(error)
                continue
        print("\n%s: GitLab data gathering complete!" % hostUrl)
        continue
    if repoType != "github":
        print("%s: Invalid repo type %s" % (hostUrl, repoType))
        sys.exit(1)

    orglist = hostInfo["orgs"]
    repolist = hostInfo["repos"]

    # Initialize query manager
    '''
    TODO we will soon want to do a couple of things:
    1. The type of the "queryMan" object should be determined by the "repoType" string (i.e. GitlabQueryManger)
    2. We will need to pass in "hostUrl" as an eventual constructor argument
    3. Make all functions abstract in the base class for easier typing
    '''
    queryMan = qm.GitHubQueryManager(apiToken=env.get(hostInfo["apiEnvKey"]))

    # Iterate through orgs of interest
    print("%s: Gathering data across multiple paginated queries..." % hostUrl)
    for org in orglist:
        print("\n'%s'" % (org))

        try:
            outObj = queryMan.queryGitHubFromFile(
                queryPath,
                {"orgName": org, "numRepos": 50, "pgCursor": None},
                paginate=True,
                cursorVar="pgCursor",
                keysToList=["data", "organization", "repositories", "nodes"],
            )
        except Exception as error:
            print("Warning: Could not complete '%s'" % (org))
            print(error)
            continue

        # Update collective data
        for repo in outObj["data"]["organization"]["repositories"]["nodes"]:
            repoKey = repo["nameWithOwner"]
            # TODO maybe handle each hostURL differently?
            dataCollector.data["data"][repoKey] = repo
            if repoKey in cdash_mapping:
                dataCollector.data["data"][repoKey]["cdash"] = cdash_mapping[repoKey]

        print("'%s' Done!" % (org))

    print("\n%s: Collective data gathering Part1of2 complete!" % (hostUrl))

    # Iterate through independent repos
    print("%s: Adding independent repos..." % (hostUrl))
    print("%s: Gathering data across multiple queries..." % (hostUrl))
    for repo in repolist:
        print("\n'%s'" % (repo))

        r = repo.split("/")
        try:
            outObj = queryMan.queryGitHubFromFile(
                queryPathInd, {"ownName": r[0], "repoName": r[1]}
            )
        except Exception as error:
            print("Warning: Could not complete '%s'" % (repo))
            print(error)
            continue

        # Update collective data
        repoKey = outObj["data"]["repository"]["nameWithOwner"]
        # TODO maybe handle each hostURL differently?
        dataCollector.data["data"][repoKey] = outObj["data"]["repository"]
        if repoKey in cdash_mapping:
            dataCollector.data["data"][repoKey]["cdash"] = cdash_mapping[repoKey]

        print("'%s' Done!" % (repo))

    print("\n%s: Collective data gathering Part2of2 complete!" % (hostUrl))

# Write output file
dataCollector.fileSave(newline="\n")

print("\nDone!\n")
