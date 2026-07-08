export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <span className="text-center text-2xl font-semibold tracking-tight text-primary">
          Finance App
        </span>
        {children}
      </div>
    </div>
  );
}
