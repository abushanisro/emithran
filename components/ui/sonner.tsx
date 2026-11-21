import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const sonnerTheme: NonNullable<ToasterProps["theme"]> =
    theme === "light" || theme === "dark" ? theme : "system";

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-lg group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:px-4 group-[.toaster]:py-3 group-[.toaster]:text-sm group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-md " +
            // A thin status-coloured edge on the left; the surface stays neutral.
            "data-[type=success]:border-l-[3px] data-[type=success]:border-l-success " +
            "data-[type=error]:border-l-[3px] data-[type=error]:border-l-destructive " +
            "data-[type=warning]:border-l-[3px] data-[type=warning]:border-l-warning " +
            "data-[type=info]:border-l-[3px] data-[type=info]:border-l-info",
          title: "group-[.toast]:font-medium group-[.toast]:text-foreground",
          description: "group-[.toast]:text-xs group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
