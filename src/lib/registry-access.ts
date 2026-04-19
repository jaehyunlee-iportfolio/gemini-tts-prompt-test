/** Google Workspace 도메인 — signIn에서만 허용 */
export const ALLOWED_GOOGLE_EMAIL_DOMAIN = "iportfolio.co.kr";

/** 항상 레지스트리 관리자이며 UI에서 제거할 수 없음 */
export const SUPER_REGISTRY_ADMIN_EMAIL = "jaehyunlee@iportfolio.co.kr";

/** @deprecated 이름 호환 — 슈퍼 관리자와 동일 */
export const REGISTRY_ADMIN_EMAIL = SUPER_REGISTRY_ADMIN_EMAIL;

export function isAllowedGoogleEmailDomain(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return e.endsWith(`@${ALLOWED_GOOGLE_EMAIL_DOMAIN}`);
}

/** 클라이언트 힌트용(서버 최종 판단은 resolveRegistryAdminEmails) */
export function isLikelySuperRegistryAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().trim() === SUPER_REGISTRY_ADMIN_EMAIL.toLowerCase();
}

export function registryForbiddenBody() {
  return {
    error:
      "프롬프트 레지스트리는 관리자로 등록된 @iportfolio.co.kr Google 계정으로만 사용할 수 있습니다.",
  } as const;
}
