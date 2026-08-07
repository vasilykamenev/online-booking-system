"use server";

import { searchVessels, type SearchFilters, type SearchResult } from "@/server/queries/vessels";

export async function loadMoreVessels(filters: SearchFilters): Promise<SearchResult> {
  return searchVessels(filters);
}
