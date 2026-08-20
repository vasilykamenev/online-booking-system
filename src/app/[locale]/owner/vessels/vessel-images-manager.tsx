"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { Star, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  addVesselImage,
  removeVesselImage,
  setPrimaryVesselImage,
  type VesselActionState,
} from "@/server/actions/vessels";
import { vesselImageMaxCount } from "@/lib/validation/vessel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LocalizedText } from "@/server/queries/vessels";

const initialState: VesselActionState = {};

export function VesselImagesManager({
  vesselId,
  images,
}: {
  vesselId: string;
  images: { id: string; url: string; altText: LocalizedText }[];
}) {
  const t = useTranslations("owner.vessels.form");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    addVesselImage.bind(null, locale, vesselId),
    initialState,
  );
  const [isRemoving, startRemoving] = useTransition();
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [isSettingPrimary, startSettingPrimary] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isFirstRender = useRef(true);
  const maxReached = images.length >= vesselImageMaxCount;
  // Images arrive pre-sorted by sort_order (server/queries/owner.ts) — the first one is the cover photo.
  const primaryId = images[0]?.id;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!state.error) {
      formRef.current?.reset();
    }
  }, [state]);

  function handleRemove(imageId: string) {
    startRemoving(async () => {
      const result = await removeVesselImage(locale, vesselId, imageId);
      if (result.error) {
        toast.error(t("errors.generic"));
        return;
      }
      router.refresh();
    });
  }

  function handleSetPrimary(imageId: string) {
    setSettingPrimaryId(imageId);
    startSettingPrimary(async () => {
      const result = await setPrimaryVesselImage(locale, vesselId, imageId);
      if (result.error) {
        toast.error(t("errors.generic"));
      }
      router.refresh();
    });
  }

  return (
    <div>
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image) => {
            const isPrimary = image.id === primaryId;
            return (
              <li
                key={image.id}
                className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-muted"
              >
                <Image
                  src={image.url}
                  alt={image.altText[locale] ?? ""}
                  fill
                  sizes="150px"
                  className="object-cover"
                />
                {isPrimary ? (
                  <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    <Star className="size-3 fill-primary text-primary" strokeWidth={1.5} />
                    {t("primaryBadge")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(image.id)}
                    disabled={isSettingPrimary}
                    className={cn(
                      "absolute bottom-1 left-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100",
                      isSettingPrimary && settingPrimaryId === image.id && "opacity-100",
                    )}
                  >
                    {t("setPrimary")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(image.id)}
                  disabled={isRemoving}
                  aria-label={t("removeImage")}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {maxReached ? (
        <p className="mt-4 text-xs text-muted-foreground">{t("errors.maxImages")}</p>
      ) : (
        <form
          ref={formRef}
          action={formAction}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <Input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            required
          />
          <Input name="altTextRu" placeholder={t("altTextRu")} />
          <Input name="altTextEn" placeholder={t("altTextEn")} />
          <p className="text-xs text-muted-foreground sm:col-span-3">
            {t("imageFileHint")} {t("photosRemaining", { count: vesselImageMaxCount - images.length })}
          </p>
          {state.error && (
            <p className="text-sm text-destructive sm:col-span-3">{t(`errors.${state.error}`)}</p>
          )}
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending}
            className="w-fit rounded-full sm:col-span-3"
          >
            {t("addImage")}
          </Button>
        </form>
      )}
    </div>
  );
}
