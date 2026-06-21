import { NextResponse } from "next/server";

const globalForSession = globalThis as typeof globalThis & {
  __hrmsSessionInstanceId?: string;
};

if (!globalForSession.__hrmsSessionInstanceId) {
  globalForSession.__hrmsSessionInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    id: globalForSession.__hrmsSessionInstanceId,
  });
}
