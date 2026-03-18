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
          Accept: "application/json"
        },
        next: {
          revalidate: 0
        }
      }
    );

    if (!response.ok) {
      return NextResponse.json({ suggestions: [] });
    }

    const payload = (await response.json()) as DuckDuckGoSuggestion[];
    const suggestions = payload
      .map((item) => item.phrase?.trim() ?? "")
      .filter(Boolean)
      .slice(0, 8);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
