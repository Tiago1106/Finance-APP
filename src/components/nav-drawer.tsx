"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarCheck,
  CreditCard,
  Home,
  LandmarkIcon,
  List,
  Menu,
  PiggyBank,
  Tags,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

const LINKS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/transacoes", label: "Transações", icon: List },
  { href: "/pagamentos", label: "Pagamentos", icon: CalendarCheck },
  { href: "/faturas", label: "Faturas", icon: CreditCard },
  { href: "/orcamentos", label: "Orçamentos", icon: PiggyBank },
  { href: "/contas", label: "Contas", icon: LandmarkIcon },
  { href: "/categorias", label: "Categorias", icon: Tags },
  { href: "/familia", label: "Família", icon: Users },
  { href: "/perfil", label: "Perfil", icon: User },
];

export function NavDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="left">
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu">
          <Menu className="size-5" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="w-64">
        <DrawerHeader>
          <DrawerTitle className="text-primary">Finance App</DrawerTitle>
        </DrawerHeader>
        <nav className="flex flex-col gap-1 px-2 pb-4">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </DrawerContent>
    </Drawer>
  );
}
