# Gemini TTS Prompt Tester

LAURA TTS 생성형 음성의 프롬프트 안정성을 테스트하기 위한 웹 도구 + 프롬프트 버전 가이드 Confluence 자동 동기화.

## 기능

### 1. TTS Prompt Test Web App (`index.html`, Vercel)

- **프롬프트 프리셋**: `docs/prompt-registry.json`에서 로드 (실패 시 내장 fallback)
- **레지스트리 편집**: 새 리비전 / 새 프롬프트 / 새 그룹 — 저장 시 **GitHub `docs/`에 직접 커밋**되고, `LAURA-TTS-프롬프트-버전-가이드.md`가 같은 내용으로 재생성됨
- **자동 버저닝**: 동일 프롬프트에 대해 최신 `vX.Y`의 `Y`가 1씩 증가 (예: `v1.2` → `v1.3`). 새 프롬프트는 `v1.0`부터 시작
- **캐시 우회**: 동일 bundleName + text 캐시 우회용 보이지 않는 토큰
- **API 프록시**: TTS 인증은 서버 환경변수만 사용 (클라이언트에 노출 안 됨)

### 2. Confluence 자동 동기화

`docs/` 변경이 `main`에 반영되면 GitHub Actions가 Confluence를 업데이트합니다. 웹에서 저장한 커밋도 `main`에 들어가므로 동일하게 동작합니다.

## 문서 구조

```
├── index.html
├── docs/
│   ├── prompt-registry.json              ← 프롬프트 단일 소스 (웹에서도 편집 반영)
│   └── LAURA-TTS-프롬프트-버전-가이드.md  ← 레지스트리에서 생성 (Confluence 동기화)
├── api/                                  ← Vercel serverless (TTS 프록시 + 레지스트리)
├── scripts/
│   └── bootstrap-prompt-registry.mjs     ← 초기 JSON 재생성용 (선택)
└── .github/workflows/confluence-sync.yml
```

## Vercel 환경 변수

| 변수 | 설명 |
|------|------|
| `TTS_AUTH_TOKEN` | TTS API `X-SS-Authorization` 값 |
| `GITHUB_TOKEN` | `repo` Contents 읽기/쓰기 권한의 PAT (또는 Fine-grained: 이 저장소 contents write) |
| `GITHUB_OWNER` | 예: `jaehyunlee-iportfolio` |
| `GITHUB_REPO` | 예: `gemini-tts-prompt-test` |
| `GITHUB_BRANCH` | 선택, 기본 `main` |
| `PROMPT_ADMIN_SECRET` | 웹에서 `docs/` 반영 시 사용하는 임의의 비밀 문자열 (브라우저는 `X-Prompt-Admin-Secret` 헤더로 전송) |

## GitHub Actions (Confluence) Secrets

| Secret | 값 |
|--------|---|
| `CONFLUENCE_URL` | `https://ipf-jira.atlassian.net/wiki` |
| `CONFLUENCE_SPACE_KEY` | `LR` |
| `CONFLUENCE_EMAIL` | `jaehyunlee@iportfolio.co.kr` |
| `CONFLUENCE_API_TOKEN` | Atlassian API 토큰 |

## 로컬에서 `prompt-registry.json`만 다시 만들기

```bash
node scripts/bootstrap-prompt-registry.mjs
node -e "const r=require('./api/_lib/registry-md.js');const fs=require('fs');const reg=JSON.parse(fs.readFileSync('docs/prompt-registry.json','utf8'));fs.writeFileSync('docs/LAURA-TTS-프롬프트-버전-가이드.md', r.registryToMarkdown(reg));"
```

## Confluence 페이지 매핑

| 마크다운 파일 | Confluence |
|-------------|-----------|
| `docs/LAURA-TTS-프롬프트-버전-가이드.md` | [LAURA TTS](https://ipf-jira.atlassian.net/wiki/spaces/LR/pages/4077617176) |
