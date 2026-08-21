"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { Star, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { addVesselImage, removeVesselImage, setPrimaryVesselImage } from "@/server/actions/vessels";
import { uploadAndAttachVesselPhotos, validateVesselImageFile } from "@/lib/images/upload-raw";
import { vesselImageAllowedTypes, vesselImageMaxCount } from "@/lib/validation/vessel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LocalizedText } from "@/server/queries/vessels";

export function VesselImagesManager({
  vesselId,
  vesselName,
  images,
}: {
  vesselId: string;
  vesselName: string;
  images: { id: string; url: string; altText: LocalizedText }[];
}) {
  const t = useTranslations("owner.vessels.form");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isRemoving, startRemoving] = useTransition();
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [isSettingPrimary, startSettingPrimary] = useTransition();
  const maxReached = images.length >= vesselImageMaxCount;
  // Images arrive pre-sorted by sort_order (server/queries/owner.ts) — the first one is the cover photo.
  const primaryId = images[0]?.id;

  // The file is uploaded directly to Supabase Storage from the browser (see uploadRawVesselImage)
  // before `addVesselImage` is ever called, so the Server Action only ever receives the resulting
  // storage path plus two short text fields — never the photo's bytes. That's what keeps this
  // request body tiny regardless of the original photo's size ("Body exceeded 1 MB limit" no
  // longer applies here).
  const [isAdding, startAdding] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<"tooLarge" | "invalidType" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altTextRuRef = useRef<HTMLInputElement>(null);
  const altTextEnRef = useRef<HTMLInputElement>(null);

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setFileError(file ? validateVesselImageFile(file) : null);
  }

  function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || fileError) return;
    setAddError(null);
    startAdding(async () => {
      const result = await uploadAndAttachVesselPhotos(vesselId, vesselName, [selectedFile], (id, rawPath) =>
        addVesselImage(locale, id, vesselName, rawPath, altTextRuRef.current?.value, altTextEnRef.current?.value),
      );
      if (result.error) {
        setAddError(t(`errors.${result.error}`));
        return;
      }
      setSelectedFile(null);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (altTextRuRef.current) altTextRuRef.current.value = "";
      if (altTextEnRef.current) altTextEnRef.current.value = "";
      router.refresh();
    });
  }

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
        <form onSubmit={handleAddSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            ref={fileInputRef}
            type="file"
            accept={vesselImageAllowedTypes.join(",")}
            onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            aria-invalid={Boolean(fileError)}
            required
          />
          <Input ref={altTextRuRef} name="altTextRu" placeholder={t("altTextRu")} />
          <Input ref={altTextEnRef} name="altTextEn" placeholder={t("altTextEn")} />
          <p className="text-xs text-muted-foreground sm:col-span-3">
            {t("imageFileHint")} {t("photosRemaining", { count: vesselImageMaxCount - images.length })}
          </p>
          {fileError && (
            <p className="text-sm text-destructive sm:col-span-3">{t(`errors.${fileError}`)}</p>
          )}
          {addError && <p className="text-sm text-destructive sm:col-span-3">{addError}</p>}
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isAdding || !selectedFile || Boolean(fileError)}
            className="w-fit rounded-full sm:col-span-3"
          >
            {t("addImage")}
          </Button>
        </form>
      )}
    </div>
  );
}
