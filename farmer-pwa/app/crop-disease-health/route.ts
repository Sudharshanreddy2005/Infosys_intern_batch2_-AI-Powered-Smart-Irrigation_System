import { NextResponse } from "next/server";

function resolveCropDiseaseOrigin(): string {
  return (
    process.env.CROP_DISEASE_ORIGIN ??
    process.env.CROP_DISEASE_URL ??
    process.env.NEXT_PUBLIC_CROP_DISEASE_URL ??
    "http://localhost:8001"
  ).replace(/\/+$/, "");
}

export async function GET() {
  const origin = resolveCropDiseaseOrigin();
  const healthUrl = `${origin}/health`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw || null;
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: response.status,
          origin,
          message: "The crop disease service is reachable but returned an unhealthy status.",
          health: payload,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: response.status,
      origin,
      message: "Crop disease service is reachable.",
      health: payload,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The crop disease service did not respond before the timeout expired."
      : "The crop disease service is unavailable. Set CROP_DISEASE_ORIGIN to the actual reachable service URL.";

    return NextResponse.json(
      {
        ok: false,
        status: 503,
        origin,
        message,
      },
      { status: 503 },
    );
  }
}
