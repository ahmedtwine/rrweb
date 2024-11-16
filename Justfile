dev-web-extension:
	@yarn install
	@yarn dev:web-extension

build-web-extension:
    @yarn workspace @rrweb/web-extension build

git-merge-to-master:
    #!/usr/bin/env bash
    set -euo pipefail
    # Get current branch name
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    # Confirm with the user
    read -p "Are you sure you want to merge '$current_branch' into master and force push? (y/n): " confirm
    if [[ $confirm != [yY] ]]; then
        echo "Operation cancelled."
        exit 1
    fi
    # Switch to master and update it
    git checkout master
    git pull origin master
    # Merge the current branch into master, squashing all commits
    git merge --squash "$current_branch"
    # Commit the changes with a message referencing the original branch
    git commit -m "Merge branch '$current_branch' into master" --no-verify
    # Force push to origin master
    git push origin master --force
    sleep 3
    git branch -d "$current_branch"
    echo "Branch '$current_branch' has been merged into master and force pushed to origin."
    git pull