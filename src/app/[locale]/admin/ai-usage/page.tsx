import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getAnthropicUsageReport, type DailySpend } from "@/server/queries/anthropic-usage";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.aiUsage" });
  return { title: buildTitle(t("title")) };
}

function formatUsd(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default async function AdminAiUsagePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.aiUsage");

  const outcome = await getAnthropicUsageReport();

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {outcome.status === "not-configured" && (
        <NoticeCard heading={t("notConfigured.heading")} body={t("notConfigured.body")} />
      )}
      {outcome.status === "error" && (
        <NoticeCard heading={t("error.heading")} body={t("error.body")} />
      )}

      {outcome.status === "ok" && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTile label={t("last7d")} value={formatUsd(outcome.report.last7dTotalUsd, locale)} />
            <StatTile label={t("last30d")} value={formatUsd(outcome.report.last30dTotalUsd, locale)} />
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h2 className="text-sm font-medium tracking-tight">{t("dailySpend")}</h2>
            <DailySpendChart daily={outcome.report.daily} locale={locale} />
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="p-4">
              <h2 className="text-sm font-medium tracking-tight">{t("byModel")}</h2>
            </div>
            {outcome.report.byModel.length === 0 ? (
              <p className="px-4 pb-6 text-sm font-light text-muted-foreground">{t("noData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.model")}</TableHead>
                    <TableHead className="text-right">{t("columns.spend")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outcome.report.byModel.map((entry) => (
                    <TableRow key={entry.model}>
                      <TableCell>{entry.model}</TableCell>
                      <TableCell className="text-right">{formatUsd(entry.amountUsd, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-light">{value}</p>
    </div>
  );
}

function NoticeCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
      <h2 className="text-base font-medium tracking-tight">{heading}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-light text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * A single-series bar chart, server-rendered (no client JS, no charting dependency — CLAUDE.md §11
 * forbids adding one the stack doesn't already list). One series needs no legend (`dataviz` skill's
 * own rule) — the section heading above already names it. Each bar's native SVG `<title>` gives a
 * zero-JS hover tooltip; top-only-rounded, baseline-anchored bars per the skill's mark spec.
 */
function DailySpendChart({ daily, locale }: { daily: DailySpend[]; locale: string }) {
  if (daily.length === 0) return null;

  const width = 640;
  const height = 160;
  const paddingBottom = 20;
  const paddingTop = 8;
  const baseline = height - paddingBottom;
  const plotHeight = baseline - paddingTop;
  const maxAmount = Math.max(...daily.map((day) => day.amountUsd), 0.01);
  const gap = 3;
  const barWidth = Math.max((width - gap * (daily.length - 1)) / daily.length, 1);
  const radius = Math.min(3, barWidth / 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-4 w-full"
      role="img"
      aria-label={new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(maxAmount)}
    >
      <line
        x1={0}
        y1={baseline}
        x2={width}
        y2={baseline}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {daily.map((day, index) => {
        const x = index * (barWidth + gap);
        const barHeight = Math.max((day.amountUsd / maxAmount) * plotHeight, 1);
        const top = baseline - barHeight;
        const r = Math.min(radius, barHeight);
        const d =
          barHeight <= r
            ? `M ${x},${baseline} L ${x},${top} L ${x + barWidth},${top} L ${x + barWidth},${baseline} Z`
            : `M ${x},${baseline} L ${x},${top + r} Q ${x},${top} ${x + r},${top} ` +
              `L ${x + barWidth - r},${top} Q ${x + barWidth},${top} ${x + barWidth},${top + r} ` +
              `L ${x + barWidth},${baseline} Z`;
        return (
          <path key={day.date} d={d} fill="var(--color-chart-1)">
            <title>{`${day.date}: ${formatUsd(day.amountUsd, locale)}`}</title>
          </path>
        );
      })}
      <text x={0} y={height} className="fill-muted-foreground" fontSize={10}>
        {daily[0]?.date}
      </text>
      <text x={width} y={height} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
        {daily[daily.length - 1]?.date}
      </text>
    </svg>
  );
}
