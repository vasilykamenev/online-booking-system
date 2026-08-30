import { NextResponse } from "next/server";
import { indexSource } from "@/server/search/index/indexer";

const BRILIONS_SOURCE_ID = "4baa2c34-17bb-4dc4-9483-e377eb1f46ee";

export async function GET() {
  const result = await indexSource(BRILIONS_SOURCE_ID);
  return NextResponse.json({ result });
}
