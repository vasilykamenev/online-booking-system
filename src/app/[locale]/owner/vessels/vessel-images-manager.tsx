"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { addVesselImage, removeVesselImage, type VesselActionState } from "@/server/actions/vessels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const formRef = useRef<HTMLFormElement>(null);
  const isFirstRender = useRef(true);

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

  return (
    <div>
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image) => (
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
          ))}
        </ul>
      )}

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
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("imageFileHint")}</p>
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
    </div>
  );
}
