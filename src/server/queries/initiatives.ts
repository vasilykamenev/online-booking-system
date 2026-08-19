import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

export interface InitiativeCard {
  id: string;
  title: string;
  description: string;
  topic: string;
  region: string;
  activityType: string;
  status: Database["public"]["Enums"]["initiative_status"];
  createdAt: string;
  authorId: string;
  authorName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const INITIATIVE_CARD_COLUMNS = `id, title, description, topic, region, activity_type, status, created_at,
       author_id, latitude, longitude, profiles ( full_name )`;

export interface InitiativeCardRow {
  id: string;
  title: string;
  description: string;
  topic: string;
  region: string;
  activity_type: string;
  status: Database["public"]["Enums"]["initiative_status"];
  created_at: string;
  author_id: string;
  latitude: number | null;
  longitude: number | null;
  profiles: { full_name: string | null } | null;
}

export function mapInitiativeCardRow(row: InitiativeCardRow): InitiativeCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    topic: row.topic,
    region: row.region,
    activityType: row.activity_type,
    status: row.status,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.profiles?.full_name ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

export interface InitiativeFilters {
  topic?: string;
  region?: string;
  activityType?: string;
  status?: Database["public"]["Enums"]["initiative_status"];
  cursor?: string;
}

export interface InitiativeSearchResult {
  initiatives: InitiativeCard[];
  nextCursor: string | null;
}

const FEED_PAGE_SIZE = 9;

export async function searchInitiatives(
  filters: InitiativeFilters,
): Promise<InitiativeSearchResult> {
  const supabase = await createClient();

  let query = supabase.from("initiatives").select(INITIATIVE_CARD_COLUMNS);

  if (filters.topic) query = query.eq("topic", filters.topic);
  if (filters.region) query = query.eq("region", filters.region);
  if (filters.activityType) query = query.eq("activity_type", filters.activityType);
  if (filters.status) query = query.eq("status", filters.status);

  if (filters.cursor) {
    const [createdAt, id] = filters.cursor.split("|");
    if (createdAt && id) {
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FEED_PAGE_SIZE + 1);

  throwIfSupabaseError(error);

  const rows = (data ?? []) as InitiativeCardRow[];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  return {
    initiatives: page.map(mapInitiativeCardRow),
    nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}

export interface InitiativeFacets {
  topics: string[];
  regions: string[];
  activityTypes: string[];
}

/** Filter options come from data already in the table, not a hardcoded list (CLAUDE.md §9). */
export async function getInitiativeFacets(): Promise<InitiativeFacets> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("initiatives")
    .select("topic, region, activity_type");
  throwIfSupabaseError(error);

  const rows = data ?? [];
  const dedupe = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

  return {
    topics: dedupe(rows.map((row) => row.topic)),
    regions: dedupe(rows.map((row) => row.region)),
    activityTypes: dedupe(rows.map((row) => row.activity_type)),
  };
}

export interface InitiativeDetail extends InitiativeCard {
  updatedAt: string;
}

export const getInitiativeById = cache(async (id: string): Promise<InitiativeDetail | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("initiatives")
    .select(`${INITIATIVE_CARD_COLUMNS}, updated_at, locations ( latitude, longitude )`)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // Malformed UUIDs come back as a Postgres error, not an empty result — treat as not-found.
    if (error.code === "22P02") return null;
    throw error;
  }
  if (!data) return null;

  const row = data as InitiativeCardRow & {
    updated_at: string;
    locations: { latitude: number | null; longitude: number | null } | null;
  };

  return {
    ...mapInitiativeCardRow(row),
    updatedAt: row.updated_at,
    // Falls back to the linked location's point when the author didn't drop
    // their own pin — same pattern as vessels (see getVesselBySlug).
    latitude: row.latitude ?? row.locations?.latitude ?? null,
    longitude: row.longitude ?? row.locations?.longitude ?? null,
  };
});

export interface InitiativeResponse {
  id: string;
  type: Database["public"]["Enums"]["initiative_response_type"];
  message: string | null;
  createdAt: string;
  responderId: string;
  responderName: string | null;
}

/** RLS restricts rows to the initiative's author, the responder, or an admin. */
export async function getInitiativeResponses(initiativeId: string): Promise<InitiativeResponse[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("initiative_responses")
    .select("id, type, message, created_at, responder_id, profiles ( full_name )")
    .eq("initiative_id", initiativeId)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    message: row.message,
    createdAt: row.created_at,
    responderId: row.responder_id,
    responderName: row.profiles?.full_name ?? null,
  }));
}

export async function getMyInitiativeResponse(
  initiativeId: string,
  responderId: string,
): Promise<InitiativeResponse | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("initiative_responses")
    .select("id, type, message, created_at, responder_id, profiles ( full_name )")
    .eq("initiative_id", initiativeId)
    .eq("responder_id", responderId)
    .maybeSingle();

  throwIfSupabaseError(error);
  if (!data) return null;

  return {
    id: data.id,
    type: data.type,
    message: data.message,
    createdAt: data.created_at,
    responderId: data.responder_id,
    responderName: data.profiles?.full_name ?? null,
  };
}

export interface MyInitiative {
  id: string;
  title: string;
  topic: string;
  region: string;
  activityType: string;
  status: Database["public"]["Enums"]["initiative_status"];
  createdAt: string;
  responseCount: number;
}

export async function getMyInitiatives(authorId: string): Promise<MyInitiative[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("initiatives")
    .select("id, title, topic, region, activity_type, status, created_at")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false });
  throwIfSupabaseError(error);

  const initiatives = data ?? [];
  if (initiatives.length === 0) return [];

  const { data: responses, error: responsesError } = await supabase
    .from("initiative_responses")
    .select("initiative_id")
    .in(
      "initiative_id",
      initiatives.map((initiative) => initiative.id),
    );
  throwIfSupabaseError(responsesError);

  const counts = new Map<string, number>();
  for (const response of responses ?? []) {
    counts.set(response.initiative_id, (counts.get(response.initiative_id) ?? 0) + 1);
  }

  return initiatives.map((initiative) => ({
    id: initiative.id,
    title: initiative.title,
    topic: initiative.topic,
    region: initiative.region,
    activityType: initiative.activity_type,
    status: initiative.status,
    createdAt: initiative.created_at,
    responseCount: counts.get(initiative.id) ?? 0,
  }));
}
