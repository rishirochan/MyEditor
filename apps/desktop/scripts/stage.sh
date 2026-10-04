#!/bin/sh
# Builds the web app and lays it out in build/ for Electron to run.
set -e
cd "$(dirname "$0")/.."

pnpm --filter @myeditor/web build

rm -rf build
mkdir -p build
# Keep symlinks as-is: pnpm's layout relies on them and they're all relative.
cp -R ../web/.next/standalone build/server
cp -R ../web/.next/static build/server/apps/web/.next/static
if [ -d ../web/public ]; then cp -R ../web/public build/server/apps/web/public; fi
cp -R ../web/drizzle build/server/apps/web/drizzle
cp -R ../../templates build/templates

# Next copies .env files into standalone output. Never ship local secrets.
find build/server -maxdepth 3 -name '.env*' -type f -delete
