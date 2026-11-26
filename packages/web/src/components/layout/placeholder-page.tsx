import type { LucideIcon } from 'lucide-react';

export function PlaceholderPage({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
