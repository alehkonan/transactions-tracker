type Props = {
  name?: string | null;
  colorHex?: string | null;
};

/** Category pill tinted with that category's own color, generated at creation time. */
export function CategoryTag({ name, colorHex }: Props) {
  if (!name) {
    return (
      <span className="border-border text-text-muted inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap">
        No category
      </span>
    );
  }

  return (
    <span
      className="inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap"
      style={
        colorHex
          ? {
              backgroundColor: `color-mix(in srgb, ${colorHex} 15%, transparent)`,
              borderColor: `color-mix(in srgb, ${colorHex} 40%, transparent)`,
              color: colorHex,
            }
          : undefined
      }
    >
      {name}
    </span>
  );
}
