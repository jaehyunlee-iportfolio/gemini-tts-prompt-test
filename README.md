# Gemini TTS Prompt Tester

LAURA TTS 생성형 음성의 프롬프트 안정성을 테스트하기 위한 웹 도구 + 프롬프트 버전 가이드 Confluence 자동 동기화.

## 기능

### 1. TTS Prompt Test Web App (`index.html`)

프롬프트별 음성 생성 차이를 브라우저에서 바로 테스트할 수 있는 싱글 페이지 앱.

- **프롬프트 프리셋**: Male Child (Default/Cheerful/Gentle) × v1.0~v1.2, Female Adult (Sulafat) 동일
- **캐시 우회**: 동일 bundleName + text 조합의 서버 캐싱을 우회하기 위해 텍스트에 보이지 않는 유니코드 토큰 자동 추가
- **SSE 스트리밍**: `/stream/start` → SSE `/streams/{sseId}` 플로우로 실시간 오디오 수신
- **결과 비교**: 생성 결과가 카드형으로 쌓여 프롬프트 간 음성 비교 가능
- **다운로드**: 생성된 오디오를 MP3로 다운로드

### 2. Confluence 자동 동기화

`docs/` 폴더의 마크다운 파일을 수정하고 `main` 브랜치에 push하면, GitHub Actions가 Confluence 페이지를 자동 업데이트.

## 문서 구조

```
├── index.html                                    ← TTS 테스트 웹앱
├── docs/
│   └── LAURA-TTS-프롬프트-버전-가이드.md          ← Confluence 동기화 대상
├── .github/workflows/
│   ├── confluence-sync.yml                        ← Confluence 자동 동기화
│   └── deploy-pages.yml                           ← GitHub Pages 배포
└── .env                                           ← API 토큰 (git 미포함)
```

## Confluence 페이지 매핑

| 마크다운 파일 | Confluence 페이지 | 페이지 ID |
|-------------|------------------|----------|
| `docs/LAURA-TTS-프롬프트-버전-가이드.md` | [LAURA TTS](https://ipf-jira.atlassian.net/wiki/spaces/LR/pages/4077617176) | 4077617176 |

## 사용법

### TTS 테스트

1. GitHub Pages에서 웹앱 접속 (또는 `index.html` 로컬 오픈)
2. Bundle Name, Text, Prompt 설정
3. "캐시 우회" 토글 확인 (프롬프트 테스트 시 반드시 ON)
4. "음성 생성" 클릭
5. 프롬프트를 변경하며 결과 비교

### 문서 수정 → Confluence 반영

1. `docs/LAURA-TTS-프롬프트-버전-가이드.md` 수정
2. 커밋 & push
3. GitHub Actions가 자동으로 Confluence 페이지 업데이트

## 초기 설정 (GitHub Secrets)

GitHub 저장소 > Settings > Secrets and variables > Actions에 아래 Secret 추가:

| Secret 이름 | 값 |
|------------|---|
| `CONFLUENCE_URL` | `https://ipf-jira.atlassian.net/wiki` |
| `CONFLUENCE_SPACE_KEY` | `LR` |
| `CONFLUENCE_EMAIL` | `jaehyunlee@iportfolio.co.kr` |
| `CONFLUENCE_API_TOKEN` | `.env` 파일의 `jira_api_key` 값 |
