"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateUserRole } from "@/server/actions/admin";
import { userRoleValues } from "@/lib/validation/admin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserRole = (typeof userRoleValues)[number];

export function UserRoleSelect({
  userId,
  role,
  disabled = false,
}: {
  userId: string;
  role: UserRole;
  disabled?: boolean;
}) {
  const t = useTranslations("admin.users");
  const tRoles = useTranslations("admin.users.roles");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await updateUserRole(locale, userId, value as UserRole);
      if (result.error) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("updated"));
      router.refresh();
    });
  }

  return (
    <Select value={role} onValueChange={handleChange} disabled={disabled || isPending}>
      <SelectTrigger className="w-32" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {userRoleValues.map((value) => (
          <SelectItem key={value} value={value}>
            {tRoles(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
