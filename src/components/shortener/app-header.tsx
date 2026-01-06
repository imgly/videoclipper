import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type AppHeaderProps = {
  onLogoClick?: () => void;
};

const AppHeader = ({ onLogoClick }: AppHeaderProps) => (
  <header className="border-b">
    <div className="container flex h-16 items-center justify-between gap-4">
      <Link
        href="/"
        className="flex items-center gap-2 text-lg font-semibold tracking-tight transition hover:text-foreground/80"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          onLogoClick?.();
        }}
      >
        <Sparkles className="h-5 w-5 text-primary" />
        VideoClipper
      </Link>
      <ThemeToggle />
    </div>
  </header>
);

export default AppHeader;
