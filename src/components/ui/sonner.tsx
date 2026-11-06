import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          // Solid backgrounds (audit #10): the pale green-on-white toasts
          // were hard to read. Each type gets a solid background with
          // readable text. 0-result outcomes use a neutral/info toast, not
          // green success — see the call sites.
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg max-w-[calc(100vw-2rem)] break-words",
          success:
            "group-[.toaster]:!bg-emerald-600 group-[.toaster]:!text-white group-[.toaster]:!border-emerald-700",
          error:
            "group-[.toaster]:!bg-red-600 group-[.toaster]:!text-white group-[.toaster]:!border-red-700",
          warning:
            "group-[.toaster]:!bg-amber-500 group-[.toaster]:!text-white group-[.toaster]:!border-amber-600",
          info:
            "group-[.toaster]:!bg-slate-700 group-[.toaster]:!text-white group-[.toaster]:!border-slate-800",
          description: "group-[.toast]:text-inherit group-[.toast]:opacity-90 break-words",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
