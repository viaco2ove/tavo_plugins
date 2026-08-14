#!/bin/bash
# Package the plugin as .tpg (zip format)

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PLUGIN_DIR/.."

# Remove old package
rm -f toonflow_story_memory_manager.tpg

# Package (exclude README and build scripts)
zip -r toonflow_story_memory_manager.tpg toonflow_story_memory_manager/manifest.json \
    toonflow_story_memory_manager/entry.js \
    toonflow_story_memory_manager/locales \
    toonflow_story_memory_manager/ui

echo "Packaged: toonflow_story_memory_manager.tpg"
ls -lh toonflow_story_memory_manager.tpg