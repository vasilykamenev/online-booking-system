import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getAllProfiles } from "@/server/queries/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRoleSelect } from "./user-role-select";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.users" });
  return { title: `${t("title")} — Meridian` };
}

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.users");

  const currentProfile = await requireProfile(locale);
  const users = await getAllProfiles();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.user")}</TableHead>
              <TableHead>{t("columns.joined")}</TableHead>
              <TableHead>{t("columns.role")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <p className="text-sm font-medium">{user.fullName || t("unnamed")}</p>
                  <p className="text-xs font-light text-muted-foreground">{user.email}</p>
                </TableCell>
                <TableCell>{dateFormatter.format(new Date(user.createdAt))}</TableCell>
                <TableCell>
                  <UserRoleSelect
                    userId={user.id}
                    role={user.role}
                    disabled={user.id === currentProfile.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
