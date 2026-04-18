# Gemini TTS Prompt Tester

LAURA TTS 생성형 음성의 프롬프트 안정성을 테스트하기 위한 **Next.js** 웹 앱 + 프롬프트 버전 가이드 Confluence 자동 동기화.

## 기능

### 1. TTS Prompt Test Web App (Next.js, Vercel)

- **UI**: Next.js App Router + TypeScript + shadcn/ui. Voice·Style 선택으로 `bundleName` 조합, 생성 결과는 마스터–디테일 + 히스토리 상한.
- **프롬프트 프리셋**: `GET /api/prompt-registry`로 `docs/prompt-registry.json` 반영 (실패 시 내장 fallback).
- **레지스트리 편집**: 웹에서는 **새 리비전**만 저장 가능(동일 프롬프트). 새 그룹·새 프롬프트(v1.0) 웹 UI/API는 **deprecated** — `docs/prompt-registry.json`은 GitHub에서 직접 수정. 저장 시 **GitHub `docs/`에 직접 커밋**되고, `LAURA-TTS-프롬프트-버전-가이드.md`가 같은 내용으로 재생성됨.
- **자동 버저닝**: 동일 프롬프트에 대해 최신 `vX.Y`의 `Y`가 1씩 증가 (예: `v1.2` → `v1.3`).
- **캐시 우회**: 동일 bundleName + text 캐시 우회용 보이지 않는 토큰.
- **API 프록시**: TTS 인증은 서버 환경변수만 사용 (클라이언트에 노출 안 됨). 라우트는 `src/app/api/**/route.ts`.

### 2. Confluence 자동 동기화

`docs/` 변경이 `main`에 반영되면 GitHub Actions가 Confluence를 업데이트합니다. 웹에서 저장한 커밋도 `main`에 들어가므로 동일하게 동작합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` — TTS·레지스트리 API는 같은 오리진의 `/api/*`로 제공됩니다.

프로덕션 빌드:

```bash
npm run build
npm start
```

## 문서 구조

```
├── src/
│   ├── app/
│   │   ├── page.tsx                    ← 메인 UI
│   │   ├── layout.tsx
│   │   └── api/                        ← Route Handlers (TTS 프록시 + 레지스트리)
│   ├── components/                     ← shadcn + TtsApp
│   └── lib/server/                     ← GitHub·registry MD (서버 전용)
├── docs/
│   ├── prompt-registry.json            ← 프롬프트 단일 소스
│   └── LAURA-TTS-프롬프트-버전-가이드.md  ← 레지스트리에서 생성 (Confluence 동기화)
├── scripts/
│   └── bootstrap-prompt-registry.mjs   ← 초기 JSON 재생성용 (선택)
├── vercel.json                         ← 일부 route maxDuration 등
└── .github/workflows/confluence-sync.yml
```

## Vercel 배포

프로젝트를 **Next.js**로 연결하면 빌드 커맨드는 `npm run build`, 출력은 Next 기본입니다. 루트의 `vercel.json`은 `src/app/api/...` 함수에 대한 `maxDuration` 등을 설정합니다.

### 환경 변수

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
```

가이드 MD를 레지스트리와 맞추려면 저장소의 `src/lib/server/registry-md.ts`의 `registryToMarkdown` 로직을 기준으로 동기화하거나, 웹의 **새 리비전 저장**으로 GitHub에 반영하세요.

## Confluence 페이지 매핑

| 마크다운 파일 | Confluence |
|-------------|-----------|
| `docs/LAURA-TTS-프롬프트-버전-가이드.md` | [LAURA TTS](https://ipf-jira.atlassian.net/wiki/spaces/LR/pages/4077617176) |
