import { NextResponse } from "next/server";

type DuckDuckGoSuggestion = {
  phrase?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const response = await fetch(
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
        },
        next: {
          revalidate: 0
        }
      }
    );

    if (!response.ok) {
      return NextResponse.json({ suggestions: [] });
    }

    const payload = (await response.json()) as unknown;
    const suggestions = extractSuggestions(payload).slice(0, 8);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

function extractSuggestions(payload: unknown) {
  if (!Array.isArray(payload)) {
    return [];
  }

  if (
    payload.length >= 2 &&
    typeof payload[0] === "string" &&
    Array.isArray(payload[1])
  ) {
    return payload[1]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  return payload
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (item && typeof item === "object" && "phrase" in item) {
        return (item as DuckDuckGoSuggestion).phrase?.trim() ?? "";
      }

      return "";
    })
    .filter(Boolean);
}
