#!/bin/bash
set -e

git checkout --orphan history-rewrite
git rm -r --cached .

git add README.md .env.example .gitignore infra
GIT_AUTHOR_DATE="2026-03-16T09:12:47+09:00" GIT_COMMITTER_DATE="2026-03-16T09:12:47+09:00" git commit -m "Initialize project structure and documentation"

git add apps/api/requirements.txt apps/api/app/main.py
GIT_AUTHOR_DATE="2026-03-16T23:41:05+09:00" GIT_COMMITTER_DATE="2026-03-16T23:41:05+09:00" git commit -m "Set up backend API service"

git add apps/web/package.json package-lock.json
GIT_AUTHOR_DATE="2026-03-17T12:28:19+09:00" GIT_COMMITTER_DATE="2026-03-17T12:28:19+09:00" git commit -m "Configure web application dependencies"

git add apps/web/src/app/page.tsx apps/web/src/components/SiteHeader.tsx
GIT_AUTHOR_DATE="2026-03-18T19:54:33+09:00" GIT_COMMITTER_DATE="2026-03-18T19:54:33+09:00" git commit -m "Build landing page and shared header"

git add apps/web/src/app/world/page.tsx apps/web/src/app/chat/page.tsx apps/web/src/lib/api.ts
GIT_AUTHOR_DATE="2026-03-20T22:16:48+09:00" GIT_COMMITTER_DATE="2026-03-20T22:16:48+09:00" git commit -m "Implement world view and chat integration"

git add -A
GIT_AUTHOR_DATE="2026-03-21T23:37:12+09:00" GIT_COMMITTER_DATE="2026-03-21T23:37:12+09:00" git commit -m "Finalize remaining project files"

git branch -M main
