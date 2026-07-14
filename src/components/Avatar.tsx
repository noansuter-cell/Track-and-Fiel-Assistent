"use client";

/** Squircle initials avatar with a per-name gradient. */
export default function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hash} 75% 72%), hsl(${(hash + 45) % 360} 70% 52%))`,
      }}
    >
      {initials}
    </span>
  );
}
