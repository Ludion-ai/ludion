# Applied to the list of open PRs from the run's branch into the default branch: "<number> <head SHA>" of the one PR
# from the run's own repository and branch, else "- -". A copy of judge-comment.yml's PICK.
[.[] | select(.head.repo.full_name == $repo and .head.ref == $ref)]
| if length == 1 then "\(.[0].number) \(.[0].head.sha)" else "- -" end
