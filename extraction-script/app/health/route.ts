import { NextResponse } from "next/server";

export function GET(request: Request) {
    const userAgent = request.headers.get("user-agent") || "unknown";
    console.log(`[health] probe from ua="${userAgent}"`);
    return NextResponse.json({ status: "ok", service: "extraction-script" });
}
