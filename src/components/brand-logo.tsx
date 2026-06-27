import { cn } from "@/lib/utils";

type Props = { className?: string; size?: "sm" | "md" | "lg" };

export function BrandLogo({ className, size = "md" }: Props) {
  const sizes = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-4xl md:text-5xl",
  } as const;
  return (
    <span
      className={cn(
        "font-display font-extrabold tracking-tight inline-flex items-baseline gap-[0.05em]",
        sizes[size],
        className,
      )}
      aria-label="DropList"
    >
      <span style={{ color: "var(--brand-red)" }}>D</span>
      <span style={{ color: "var(--brand-blue)" }}>r</span>
      <span style={{ color: "var(--brand-yellow)" }}>o</span>
      <span style={{ color: "var(--brand-green)" }}>p</span>
      <span className="text-foreground">List</span>
    </span>
  );
}
