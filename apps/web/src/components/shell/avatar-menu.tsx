"use client";

import Link from "next/link";
import { Award, CreditCard, GraduationCap, LayoutDashboard, LogOut, Monitor, Moon, Receipt, Settings, Sun } from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-lms/ui";
import { useAuth, useMe } from "@/lib/auth";
import { useTheme, type ThemePref } from "@/lib/stores/theme";

export function AvatarMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const { pref, setPref } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" data-testid="avatar-menu" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="px-3 pb-2 pt-3">
          <p className="truncate font-semibold text-foreground">{me.displayName}</p>
          <p className="truncate text-[13px] text-muted-foreground">{me.email}</p>
          {me.subscription?.grantsAccess ? <p className="mt-1 text-[12.5px] font-medium text-primary">{me.subscription.plan.name} member</p> : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/my-learning">
            <GraduationCap /> My learning
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/my-learning?tab=certificates">
            <Award /> Certificates
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/orders">
            <Receipt /> Orders and invoices
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/subscription">
            <CreditCard /> Subscription
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <Settings /> Account settings
          </Link>
        </DropdownMenuItem>
        {me.canOpenAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin" data-testid="nav-admin">
                <LayoutDashboard /> {me.role === "INSTRUCTOR" ? "Teach" : "Admin console"}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <DropdownMenuRadioItem value="system" data-testid="theme-system">
            <Monitor /> Match device
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" data-testid="theme-light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" data-testid="theme-dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} data-testid="sign-out">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
