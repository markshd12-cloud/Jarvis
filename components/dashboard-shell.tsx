"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  BotIcon,
  BuildingIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessagesSquareIcon,
  SettingsIcon,
} from "lucide-react";

import { signOut } from "@/app/login/actions";
import type {
  ContaAzulStatus,
  MarketingStatus,
  NotionStatus,
} from "@/lib/db/connections";
import { type AccessContext, can } from "@/lib/permissions";
import { JarvisMark } from "@/components/brand/jarvis-logo";
import {
  SettingsDialog,
  type ProfileSettings,
} from "@/components/settings-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  useSidebar,
} from "@/components/ui/sidebar";
import { IconArchive } from "@tabler/icons-react";

// `feature` casa com as chaves de FEATURES em lib/permissions — todos os itens
// são filtrados por `can()`. Quem não tem nada marcado cai em /sem-acesso.
const links = [
  {
    label: "Dashboard",
    href: "/dashboard",
    feature: "dashboard",
    icon: <LayoutDashboardIcon className="h-5 w-5 shrink-0 text-sidebar-foreground" />,
  },
  {
    label: "Bate-Papo",
    href: "/chat",
    feature: "chat",
    icon: <MessagesSquareIcon className="h-5 w-5 shrink-0 text-sidebar-foreground" />,
  },
  {
    label: "Agentes",
    href: "/agentes",
    feature: "agentes",
    icon: <BotIcon className="h-5 w-5 shrink-0 text-sidebar-foreground" />,
  },
  {
    label: "Personalizar",
    href: "/personalizar",
    feature: "personalizar",
    icon: <IconArchive className="h-5 w-5 shrink-0 text-sidebar-foreground" />,
  },
];

// Área exclusiva do superadmin (gerência de empresas — inclui usuários por empresa).
const superadminLinks = [
  {
    label: "Empresas",
    href: "/empresas",
    icon: <BuildingIcon className="h-5 w-5 shrink-0 text-sidebar-foreground" />,
  },
];

export function DashboardShell({
  user,
  access,
  profileSettings,
  connections,
  children,
}: {
  user: { email: string };
  access: AccessContext;
  profileSettings: ProfileSettings;
  /**
   * `null` quando o usuário não tem nenhuma permissão de Conexões. Cada card é
   * `null` quando falta a permissão específica (Notion/Conta Azul → `conhecimento`;
   * Meta Ads → `marketing`).
   */
  connections: {
    notion: NotionStatus | null;
    contaAzul: ContaAzulStatus | null;
    marketing: MarketingStatus | null;
  } | null;
  children: React.ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navLinks = [
    ...links.filter((l) => can(access, l.feature)),
    ...(access.isSuperadmin ? superadminLinks : []),
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <SidebarLogo />
            <div className="mt-8 flex flex-col gap-2">
              {navLinks.map((link) => (
                <SidebarLink key={link.label} link={link} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <UserMenu email={user.email} onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </SidebarBody>
      </Sidebar>

      <div className="flex-1 overflow-y-auto">{children}</div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSettings={profileSettings}
        connections={connections}
      />
    </div>
  );
}

/** Logo no topo: símbolo sempre; wordmark aparece quando a sidebar abre. */
function SidebarLogo() {
  const { open, animate } = useSidebar();
  return (
    <a
      href="/dashboard"
      className="relative z-20 flex items-center justify-center gap-2 py-1"
    >
      <JarvisMark className="h-8 w-8 shrink-0 drop-shadow-[0_0_8px_var(--brand)]" />
      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="bg-clip-text text-lg font-semibold tracking-[0.3em] whitespace-pre text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(120deg, var(--logo-from), var(--logo-via), var(--logo-to))",
        }}
      >
        JARVIS
      </motion.span>
    </a>
  );
}

/** Nome/email do usuário: abre um card acima com Configurações e Sair. */
function UserMenu({
  email,
  onOpenSettings,
}: {
  email: string;
  onOpenSettings: () => void;
}) {
  const { open, animate } = useSidebar();
  const initial = email.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" />}
        className="group/sidebar flex w-full items-center justify-start gap-2 py-2 text-left"
      >
        <Avatar size="sm" className="shrink-0">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <motion.span
          animate={{
            display: animate ? (open ? "inline-block" : "none") : "inline-block",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="truncate whitespace-pre text-sm text-sidebar-foreground"
        >
          {email}
        </motion.span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onOpenSettings}>
            <SettingsIcon />
            Configurações
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              await signOut();
            }}
          >
            <LogOutIcon />
            Sair
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
