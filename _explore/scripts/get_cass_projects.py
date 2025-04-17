import requests
import re
import json

# GitHub repository details
owner = "cass-community"
repo = "cass-community.github.io"
path = "_software"

# GitHub API URL to list contents of the directory
url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
#url = f"https://github.com/cass-community/cass-community.github.io/tree/main/_software"

file_to_update = f"./_explore/input_lists.json"

# Function to get the content of a file from GitHub
def get_file_content(file_url):
    response = requests.get(file_url)
    if response.status_code == 200:
        return response.text
    else:
        return None

def update_nested_list_in_json(file_path, key_path, new_list):
    try:
        # Read the JSON file
        with open(file_path, 'r') as file:
            data = json.load(file)

        # Traverse the nested keys to find the list
        nested_data = data
        for key in key_path[:-1]:  # Navigate through the keys, excluding the last one
            if key in nested_data:
                nested_data = nested_data[key]
            else:
                print(f"Key '{key}' not found in the JSON file.")
                return

        # Update the list if the final key is valid and points to a list
        final_key = key_path[-1]
        if final_key in nested_data and isinstance(nested_data[final_key], list):
            nested_data[final_key] = new_list
        else:
            print(f"Key '{final_key}' is not a list or does not exist.")
            return

        # Write the updated JSON back to the file
        with open(file_path, 'w') as file:
            json.dump(data, file, indent=4)

        print("JSON file updated successfully.")

    except Exception as e:
        print(f"An error occurred: {e}")

# Send a GET request to the GitHub API
response = requests.get(url)

#Check if the request was successful
if response.status_code == 200:
    label = 'label: Repository'
    contents = response.json()
    # Filter and list .md files
    md_files = [file for file in contents if file['name'].endswith('.md')]

    github_list = []
    gitlab_list = []
    for md_file in md_files:
        file_url = md_file['download_url']
        content = get_file_content(file_url)
        if content:
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if re.match(r"(.*)label: Repository(.*)", line):
                    # Skip the next line if it contains 'note:'
                    next_line_index = i + 1
                    if next_line_index < len(lines) and "note:" in lines[next_line_index]:
                        next_line_index += 1
                    # Find the first line matching 'url: https://github.com(.*)' after 'label: Repository'
                    for j in range(i + 1, len(lines)):
                        github_match = re.match(r"(.*)url: https://github.com(.*)", lines[j])
                        gitlab_match = re.match(r"(.*)url: https://gitlab.*com(.*)", lines[j])
                        if github_match:
                            part_after_url = github_match.group(2).strip().lstrip('/').lower()
                            part_after_url = re.sub(r'\.git$', '', part_after_url)
                            if part_after_url.endswith('/'):
                                part_after_url = part_after_url[:-1]
                            github_list.append((part_after_url))
                            print(f"Appended \"{part_after_url}\" to github_list.")
                            break
                        elif gitlab_match:
                            part_after_url = gitlab_match.group(2).strip().lstrip('/').lower()
                            part_after_url = re.sub(r'\.git$', '', part_after_url)
                            if part_after_url.endswith('/'):
                                part_after_url = part_after_url[:-1]
                            gitlab_list.append((part_after_url))
                            break

                    # Sort the lists alphabetically by part_after_url
                    github_list.sort(key=lambda x: x[0])
                    gitlab_list.sort(key=lambda x: x[0])

    # Update the projects with github repo urls
    key_path = ['https://github.com', 'repos']
    update_nested_list_in_json(file_to_update, key_path, github_list)

    # Update the projects with gitlab repo urls
    key_path = ['https://gitlab.com', 'repos']
    update_nested_list_in_json(file_to_update, key_path, gitlab_list)

else:
    print(f"Failed to retrieve contents: {response.status_code}")
