import Image from "next/image";

const VARIANTS = {
  mark: { width: 44, height: 32, srcColor: "/logo-mark.png", srcMono: "/logo-mark-dark.png" },
  full: { width: 64, height: 56, srcColor: "/logo-full.png", srcMono: "/logo-full-dark.png" },
} as const;

export function Logo({
  variant = "mark",
  /** Force the white monochrome mark regardless of theme — for the header's
   * transparent state, where it sits on top of a photo, not the theme background. */
  forceMono = false,
  className = "h-8 w-auto",
  priority = false,
}: {
  variant?: keyof typeof VARIANTS;
  forceMono?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const { width, height, srcColor, srcMono } = VARIANTS[variant];

  if (forceMono) {
    return (
      <Image
        src={srcMono}
        alt="Meridian"
        width={width}
        height={height}
        priority={priority}
        className={className}
      />
    );
  }

  return (
    <>
      <Image
        src={srcColor}
        alt="Meridian"
        width={width}
        height={height}
        priority={priority}
        className={`${className} dark:hidden`}
      />
      <Image
        src={srcMono}
        alt="Meridian"
        width={width}
        height={height}
        priority={priority}
        className={`hidden ${className} dark:block`}
      />
    </>
  );
}
