# Agent Instructions

- Before exploring this repository, read the `codebase-memory` skill.
- Only use the codebase-memory-mcp when we need to search the project code, not for simple things like commits or git related task.
- Use the `codebase-memory-mcp` server with the existing `dsh-realbrowser` dataset for structural searches, call paths, and impact analysis.
- Check `list_projects` or `index_status` before querying. Reuse `dsh-realbrowser`; never create a duplicate dataset for this repository.
- Verify relevant graph results against source and run `check_index_coverage` for every file used as evidence.
