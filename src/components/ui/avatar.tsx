import { cn } from "@/lib/utils";

interface AvatarProps {
  image?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
}

function initials(name?: string | null, email?: string | null): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  return email?.trim()?.[0]?.toUpperCase() || "U";
}

export function Avatar({ image, name, email, size = 32, className }: AvatarProps) {
  const label = name || email || "User";
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URLs, no remote-domain config
      <img
        src={image}
        alt={label}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cn("rounded-full object-cover shrink-0", className)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      className={cn(
        "rounded-full shrink-0 bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center font-medium text-emerald-700 dark:text-emerald-300 select-none",
        className
      )}
    >
      {initials(name, email)}
    </div>
  );
}
