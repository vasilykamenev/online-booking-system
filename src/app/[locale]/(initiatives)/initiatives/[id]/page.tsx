import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getInitiativeById, getInitiativeResponses, getMyInitiativeResponse } from "@/server/queries/initiatives";
import { findDirectConversation } from "@/server/queries/messages";
import { getCurrentProfile } from "@/server/queries/profile";
import { isInitiativeFavorited } from "@/server/queries/account";
import { Badge } from "@/components/ui/badge";
import { InitiativeFavoriteButton } from "@/components/initiatives/initiative-favorite-button";
import { LocationMap } from "@/components/map/location-map";
import { RespondForm } from "./respond-form";
import { ResponsesList } from "./responses-list";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const initiative = await getInitiativeById(id);
  if (!initiative) return {};

  return {
    title: buildTitle(initiative.title),
    description: initiative.description,
  };
}

export default async function InitiativeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);

  const initiative = await getInitiativeById(id);
  if (!initiative) notFound();

  const t = await getTranslations("initiativesPage");
  const profile = await getCurrentProfile();
  const isAuthor = profile?.id === initiative.authorId;

  const [isFavorited, responses, myResponse, conversationId] = await Promise.all([
    profile ? isInitiativeFavorited(profile.id, initiative.id) : Promise.resolve(false),
    isAuthor ? getInitiativeResponses(initiative.id) : Promise.resolve([]),
    profile && !isAuthor
      ? getMyInitiativeResponse(initiative.id, profile.id)
      : Promise.resolve(null),
    profile && !isAuthor
      ? findDirectConversation(profile.id, initiative.authorId)
      : Promise.resolve(null),
  ]);

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const hasPin = initiative.latitude != null && initiative.longitude != null;

  return (
    <div className="pt-24 lg:pt-28">
      <div className="container-page pt-6">
        <Link
          href="/initiatives"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} />
          {t("detail.back")}
        </Link>
      </div>

      <section className="py-10 lg:py-14">
        <div className="container-page grid grid-cols-1 gap-12 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-normal">
                {initiative.topic}
              </Badge>
              <Badge variant="outline">{initiative.activityType}</Badge>
              <Badge variant={initiative.status === "open" ? "default" : "outline"}>
                {t(`status.${initiative.status}`)}
              </Badge>
            </div>

            <div className="mt-4 flex items-start justify-between gap-4">
              <h1 className="text-3xl font-light tracking-tight text-balance md:text-4xl">
                {initiative.title}
              </h1>
              {profile && (
                <InitiativeFavoriteButton
                  initiativeId={initiative.id}
                  initialFavorited={isFavorited}
                  className="size-10 shrink-0"
                  iconClassName="size-5"
                />
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-light text-muted-foreground">
              {hasPin ? (
                <a
                  href="#location"
                  className="flex items-center gap-1.5 transition-colors hover:text-primary"
                >
                  <MapPin className="size-4" strokeWidth={1.5} />
                  {initiative.region}
                </a>
              ) : (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" strokeWidth={1.5} />
                  {initiative.region}
                </span>
              )}
              <span>
                {t("detail.publishedBy")} {initiative.authorName ?? t("card.unknownAuthor")}
              </span>
              <span>{dateFormatter.format(new Date(initiative.createdAt))}</span>
            </div>

            <div className="mt-8 border-t border-border pt-8">
              <p className="whitespace-pre-line text-sm font-light leading-relaxed text-muted-foreground">
                {initiative.description}
              </p>
            </div>

            {hasPin && (
              <div id="location" className="mt-8 scroll-mt-28 border-t border-border pt-8">
                <span className="uppercase-label mb-4 block">{t("detail.locationEyebrow")}</span>
                <h2 className="text-base font-medium tracking-tight">{t("detail.locationTitle")}</h2>
                <p className="mt-1 text-sm font-light text-muted-foreground">{initiative.region}</p>
                <div className="mt-4">
                  <LocationMap
                    latitude={initiative.latitude!}
                    longitude={initiative.longitude!}
                    label={initiative.region}
                  />
                </div>
              </div>
            )}

            {isAuthor && (
              <div className="mt-8 border-t border-border pt-8">
                <span className="uppercase-label mb-4 block">{t("responses.eyebrow")}</span>
                <ResponsesList responses={responses} />
              </div>
            )}
          </div>

          {!isAuthor && (
            <div className="h-fit rounded-2xl border border-border bg-card p-6 shadow-soft lg:sticky lg:top-28">
              <RespondForm
                initiativeId={initiative.id}
                isAuthenticated={profile !== null}
                initiativeOpen={initiative.status === "open"}
                myResponse={myResponse}
                conversationId={conversationId}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
