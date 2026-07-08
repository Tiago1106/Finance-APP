import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { signOut } from "@/app/(auth)/actions";
import { NavDrawer } from "@/components/nav-drawer";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <NavDrawer />
            <Link href="/" className="text-lg font-semibold tracking-tight text-primary">
              Finance App
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {session.name ?? session.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
