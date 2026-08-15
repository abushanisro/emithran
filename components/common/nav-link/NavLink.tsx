'use client'

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface NavLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  to?: string;
  className?: string;
  activeClassName?: string;
  end?: boolean;
  children?: React.ReactNode;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ className, activeClassName, to, href, end = false, onClick, onMouseEnter, onTouchStart, ...props }, ref) => {
    const pathname = usePathname();
    const linkHref = (to || href) as string;

    const isActive = pathname
      ? end
        ? pathname === linkHref
        : pathname.startsWith(linkHref)
      : false;

    return (
      <Link
        ref={ref}
        href={linkHref}
        className={cn(className, isActive && activeClassName)}
        {...(onClick !== undefined ? { onClick } : {})}
        {...(onMouseEnter !== undefined ? { onMouseEnter } : {})}
        {...(onTouchStart !== undefined ? { onTouchStart } : {})}
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
