"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { toggleFavorite } from "@/server/actions/favorites";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  vesselId,
  initialFavorited = false,
  className,
  iconClassName,
}: {
  vesselId: string;
  initialFavorited?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const t = useTranslations("favorite");
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const optimistic = !favorited;
    setFavorited(optimistic);

    startTransition(async () => {
      const result = await toggleFavorite(vesselId);

      if (result.error === "unauthenticated") {
        setFavorited(!optimistic);
        toast.error(t("signInRequired"));
        router.push("/auth/login");
        return;
      }
      if (result.error) {
        setFavorited(!optimistic);
        return;
      }
      setFavorited(result.favorited);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={favorited}
      aria-label={favorited ? t("remove") : t("add")}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-card/95 backdrop-blur-sm transition-colors hover:bg-card disabled:opacity-70",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-3.5 transition-colors",
          favorited ? "fill-destructive text-destructive" : "text-muted-foreground",
          iconClassName,
        )}
        strokeWidth={1.5}
      />
    </button>
  );
}
