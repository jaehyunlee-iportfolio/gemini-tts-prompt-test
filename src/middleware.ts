import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return;
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
