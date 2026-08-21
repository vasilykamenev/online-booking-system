"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A photo upload can take a while on a slow connection, and Supabase's JS storage client uploads
 * via `fetch` (no byte-level progress events), so there's no real percentage to show. This shows
 * what we do know instead: an elapsed-seconds counter (so the owner can see the page is still
 * working, not frozen) plus, when uploading more than one file, how many of them have gone
 * through so far.
 *
 * Mount/unmount is how this resets between uploads — the caller renders it only while an upload
 * is in flight (`{isUploading && <UploadProgressIndicator .../>}`), so every appearance starts a
 * fresh clock at 0 with no extra reset logic needed.
 */
export function UploadProgressIndicator({
  current,
  total,
  label,
  secondsLabel,
  className,
}: {
  current?: number;
  total?: number;
  label: string;
  secondsLabel: (seconds: number) => string;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={1.5} aria-hidden="true" />
      <span>
        {total && total > 1 ? `${label} (${current}/${total})` : label} — {secondsLabel(seconds)}
      </span>
    </div>
  );
}
