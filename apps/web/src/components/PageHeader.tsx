export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
