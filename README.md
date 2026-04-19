# Gemini TTS Prompt Tester

LAURA TTS 생성형 음성의 프롬프트 안정성을 테스트하기 위한 **Next.js** 웹 앱 + 프롬프트 버전 가이드 Confluence 자동 동기화.

## 기능

### 1. TTS Prompt Test Web App (Next.js, Vercel)

- **UI**: Next.js App Router + TypeScript + shadcn/ui. Voice·Style 선택으로 `bundleName` 조합, 생성 결과는 마스터–디테일 + 히스토리 상한.
- **접근 제어**: Google 로그인(Auth.js v5). `@iportfolio.co.kr` 도메인만 로그인 허용. 앱 전체는 로그인 후 사용(미들웨어). **프롬프트 레지스트리 API**(`prompt-registry`, `prompt-save`)는 **관리자 이메일**로 로그인한 세션에서만 성공합니다. 관리자 = 코드에 고정된 기본 슈퍼(`jaehyunlee@iportfolio.co.kr`) + 선택 환경변수 `REGISTRY_ADMIN_EMAILS`(쉼표 구분) + GitHub `docs/registry-admins.json`(웹 UI에서 추가·제거). 그 외 동료 계정은 TTS 등은 쓰되 레지스트리는 403·내장 fallback 프롬프트를 사용합니다.
- **프롬프트 프리셋**: 관리자 세션이면 `GET /api/prompt-registry`로 `docs/prompt-registry.json` 반영. 권한 없음·실패 시 내장 fallback.
- **레지스트리 편집**: 웹에서는 **새 리비전**만 저장 가능(동일 프롬프트). 새 그룹·새 프롬프트(v1.0) 웹 UI/API는 **deprecated** — `docs/prompt-registry.json`은 GitHub에서 직접 수정. 저장 시 **GitHub `docs/`에 직접 커밋**되고, `LAURA-TTS-프롬프트-버전-가이드.md`가 같은 내용으로 재생성됨. 웹 저장은 **관리자 Google 세션**으로만 허용(구 `PROMPT_ADMIN_SECRET` 헤더 방식은 제거됨).
- **자동 버저닝**: 동일 프롬프트에 대해 최신 `vX.Y`의 `Y`가 1씩 증가 (예: `v1.2` → `v1.3`).
- **캐시 우회**: 동일 bundleName + text 캐시 우회용 보이지 않는 토큰.
- **API 프록시**: TTS 인증은 서버 환경변수만 사용 (클라이언트에 노출 안 됨). 라우트는 `src/app/api/**/route.ts`.
- **결과 이력(Firestore, 선택)**: Firebase Admin + Firestore에 로그인 이메일별로 TTS 결과 목록을 저장합니다. `GET/PUT/DELETE /api/tts-history`. 환경 변수가 없으면 기존처럼 브라우저 세션에만 두고, 설정 시 로그인 후 자동 로드·약 2초 디바운스 저장. `blob:` 오디오는 저장하지 않으며, 프록시 `playUrl`만 복원 가능합니다(업스트림 만료 시 재생 불가일 수 있음).

### 2. Confluence 자동 동기화

`docs/` 변경이 `main`에 반영되면 GitHub Actions가 Confluence를 업데이트합니다. 웹에서 저장한 커밋도 `main`에 들어가므로 동일하게 동작합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` — 로그인 후 TTS·레지스트리 API는 같은 오리진의 `/api/*`로 제공됩니다. 로컬 개발 시 `cp .env.example .env.local` 후 `.env.local`에 `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 등을 채우고, Google Cloud Console OAuth 리디렉션 URI에 `http://localhost:3000/api/auth/callback/google`을 등록하세요.

프로덕션 빌드:

```bash
npm run build
npm start
```

## 문서 구조

```
├── public/                             ← 정적 자산(빈 폴더라도 Vercel/Next 관례용)
├── src/
│   ├── app/
│   │   ├── page.tsx                    ← 메인 UI
│   │   ├── layout.tsx
│   │   └── api/                        ← Route Handlers (TTS 프록시 + 레지스트리)
│   ├── components/                     ← shadcn + TtsApp
│   └── lib/server/                     ← GitHub·registry MD (서버 전용)
├── docs/
│   ├── prompt-registry.json            ← 프롬프트 단일 소스
│   ├── registry-admins.json            ← 위임 레지스트리 관리자(웹 UI에서 편집)
│   └── LAURA-TTS-프롬프트-버전-가이드.md  ← 레지스트리에서 생성 (Confluence 동기화)
├── scripts/
│   └── bootstrap-prompt-registry.mjs   ← 초기 JSON 재생성용 (선택)
└── .github/workflows/confluence-sync.yml
```

## Vercel 배포

프로젝트를 **Next.js**로 연결하면 빌드 커맨드는 `npm run build`, 출력은 Next 기본입니다. API 타임아웃은 `src/app/api/**/route.ts`의 `export const maxDuration`으로 설정합니다(Vercel의 루트 `api/`용 `vercel.json` `functions` 패턴은 Next 라우트에 맞지 않습니다).

**Vercel 배포 오류**: `No Output Directory named "public"`이면 대시보드 **Settings → General → Framework Preset**을 **Next.js**로 두고, **Output Directory**는 비워 두세요(Next는 `.next`를 쓰며 `public/`은 정적 자산용 소스 폴더입니다). 레포 루트의 [`vercel.json`](vercel.json)에 `"framework": "nextjs"`를 넣어 두었고, 빌드 후에도 존재하는 `public/` 디렉터리(`.gitkeep`)를 포함합니다.

### 환경 변수

| 변수 | 설명 |
|------|------|
| `TTS_AUTH_TOKEN` | TTS API `X-SS-Authorization` 값 |
| `GITHUB_TOKEN` 또는 `GH_TOKEN` | 동일 PAT 하나면 됨. `repo` Contents 읽기/쓰기 (Fine-grained면 이 저장소 contents write). Vercel **Production/Preview** 환경에 모두 넣고 재배포해야 웹 저장이 동작합니다. |
| `GITHUB_OWNER` | 예: `jaehyunlee-iportfolio` |
| `GITHUB_REPO` | 예: `gemini-tts-prompt-test` |
| `GITHUB_BRANCH` | 선택, 기본 `main` |
| `AUTH_SECRET` | Auth.js 세션 암호화용 (예: `openssl rand -base64 32`) |
| `AUTH_URL` | 사이트 절대 URL (로컬: `http://localhost:3000`, Vercel 프로덕션 도메인) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 클라이언트 (승인된 리디렉션: `{AUTH_URL}/api/auth/callback/google`) |
| `REGISTRY_ADMIN_EMAILS` | 선택. 쉼표로 구분한 추가 관리자(`@iportfolio.co.kr`만). UI로는 제거할 수 없고 Vercel 환경변수에서만 뺄 수 있음 |
| `FIREBASE_PROJECT_ID` | 선택. 서비스 계정 JSON의 `project_id` |
| `FIREBASE_CLIENT_EMAIL` | 선택. 서비스 계정 JSON의 `client_email` |
| `FIREBASE_PRIVATE_KEY` | 선택. 서비스 계정 JSON의 `private_key`를 **한 줄**로 (줄바꿈은 `\n`로 이스케이프). Vercel에 붙여 넣을 때 흔한 형식 |

Firebase Console에서 **Firestore 데이터베이스**를 같은 프로젝트에 만들고, 서비스 계정에 편집 권한이 있으면 됩니다(기본 소유자/편집자 역할로 충분한 경우가 많음).

### Google Cloud에서 할 일 (OAuth)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 **프로젝트** 선택(이 앱 전용으로 새 프로젝트를 만드는 것을 권장).
2. **API 및 서비스 → OAuth 동의 화면**: 사용자 유형은 조직 정책에 맞게(내부/외부) 설정, 앱 이름·지원 이메일 등 필수 항목 저장.
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**에서 유형 **웹 애플리케이션** 선택.
4. **승인된 JavaScript 출처**: 로컬은 `http://localhost:3000`, 배포는 `https://(실제 도메인)` (예: Vercel 기본 URL 또는 커스텀 도메인).
5. **승인된 리디렉션 URI**: 각 출처마다 `…/api/auth/callback/google` 한 줄씩 추가 (예: `http://localhost:3000/api/auth/callback/google`, `https://xxx.vercel.app/api/auth/callback/google`).
6. 생성 후 표시되는 **클라이언트 ID**와 **클라이언트 보안 비밀**을 복사해 Vercel 환경 변수 또는 로컬 `.env.local`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣기.

**다른 앱(jira-gantt 등)과 클라이언트 ID/시크릿을 재사용할 수 있나?**  
기술적으로는 동일 OAuth 클라이언트에 **여러 리디렉션 URI**를 등록해 두고 여러 앱에서 같이 쓸 수 있습니다. 다만 **앱마다 별도 클라이언트**를 두는 편이 좋습니다. 한쪽 키가 유출되었을 때 영향 범위가 줄고, 리디렉션 URI·감사 로그 관리도 단순해집니다.

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
