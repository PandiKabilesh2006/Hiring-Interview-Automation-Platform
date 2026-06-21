import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define matching routes for recruiter/interviewer paths
const isRecruiterRoute = createRouteMatcher([
  "/",
  "/new",
  "/dashboard(.*)",
  "/review(.*)",
  "/questions(.*)",
  "/compare(.*)",
  "/team(.*)",
  "/templates(.*)",
  "/jobs(.*)",
  "/admin(.*)",
]);

const isCandidateRoute = createRouteMatcher([
  "/candidate",
  "/candidate/(.*)",
]);

export default clerkMiddleware((auth, req) => {
  const { userId, sessionClaims } = auth();
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/candidate-auth";

  // Redirect authenticated users away from auth pages to prevent "session already exists" errors
  if (userId && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // 1. Candidate routes protection
  if (isCandidateRoute(req)) {
    if (!userId) {
      return NextResponse.redirect(new URL("/candidate-auth", req.url));
    }
  }

  // 2. Recruiter routes protection
  if (isRecruiterRoute(req)) {
    if (!userId && !isAuthPage && pathname !== "/") {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.[\\w]+$).*)',
    // Always run for API routes, but exclude clerk webhooks
    '/(api|trpc)(.*)',
  ],
};
