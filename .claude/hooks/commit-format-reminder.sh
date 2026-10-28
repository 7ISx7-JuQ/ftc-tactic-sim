#!/usr/bin/env bash
# PreToolUse(Bash) 훅: git commit 직전에 CLAUDE.md "커밋 메시지 형식" 절을 모델 컨텍스트로 다시 넣는다.
# 형식 위반 자체는 .githooks/commit-msg가 거부한다 (여기서는 막지 않음).
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
rules=$(sed -n '/<!-- commit-format:start -->/,/<!-- commit-format:end -->/p' CLAUDE.md | sed '1d;$d')
[ -n "$rules" ] || exit 0
jq -n --arg ctx "커밋 전 확인 — CLAUDE.md 커밋 메시지 형식:
$rules" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
