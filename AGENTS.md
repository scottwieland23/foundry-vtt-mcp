# Foundry scene protection

The user has reserved scene deletion for themselves. Never delete Foundry Scene documents through MCP, SSH, browser automation, database edits, scripts, or cleanup/rollback routines. Retain partial test scenes and report their IDs for the user to inspect or delete in Foundry. Do not add scene-deletion capabilities to the bridge. Creating scenes and modifying their backgrounds/settings are allowed within the user's requested scope. Other document types retain their existing permissions.

# Creation preferences

Use the assistant's built-in image generation for portraits and maps by default. ComfyUI is optional. Keep Plutonium context small: search metadata, return short lists, and fetch only selected entries; do not preload catalogs into chat or bulk-import content. Players normally create their own PCs. Assistant-generated PCs are for explicitly requested test cases or future random-character requests. Limit live integration testing to a small representative check rather than creating many documents.
