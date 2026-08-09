import { getTranslations } from "next-intl/server";
import type { InitiativeResponse } from "@/server/queries/initiatives";
import { Badge } from "@/components/ui/badge";

export async function ResponsesList({ responses }: { responses: InitiativeResponse[] }) {
  const t = await getTranslations("initiativesPage");

  if (responses.length === 0) {
    return <p className="text-sm font-light text-muted-foreground">{t("responses.empty")}</p>;
  }

  return (
    <ul className="space-y-4">
      {responses.map((response) => (
        <li key={response.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {response.responderName ?? t("card.unknownAuthor")}
            </span>
            <Badge variant="secondary" className="font-normal">
              {t(`respond.types.${response.type}`)}
            </Badge>
          </div>
          {response.message && (
            <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
              {response.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
