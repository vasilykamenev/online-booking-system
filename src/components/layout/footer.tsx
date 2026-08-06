import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("footer");
  const columns = ["platform", "company", "support"] as const;

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="container-page py-16 lg:py-20">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <Compass className="size-5" strokeWidth={1.5} />
              <span className="text-base font-medium tracking-tight">
                Meridian
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm font-light leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
          </div>

          {columns.map((key) => (
            <div key={key}>
              <h3 className="uppercase-label mb-4">
                {t(`columns.${key}.title`)}
              </h3>
              <ul className="space-y-3">
                {t.raw(`columns.${key}.links`).map((link: string) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm font-light text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 text-xs font-light text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Meridian. {t("rights")}</span>
        </div>
      </div>
    </footer>
  );
}
