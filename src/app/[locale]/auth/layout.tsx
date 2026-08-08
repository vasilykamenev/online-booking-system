import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 pt-28 pb-16 lg:pt-32">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
