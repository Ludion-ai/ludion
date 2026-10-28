# Applied to the compare API's answer for the judged head: true when that head changes .github/, or when the answer
# lists 300 files, where GitHub stops listing them. A copy of judge-comment.yml's REFUSE.
(.files | length) >= 300
or any(.files[]; (.filename | startswith(".github/")) or ((.previous_filename // "") | startswith(".github/")))
