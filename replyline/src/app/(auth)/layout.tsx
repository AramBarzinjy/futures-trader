import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-ink-50 px-4 py-12">
      <Logo />
      <div className="mt-8 w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-ink-200">{children}</div>
    </div>
  );
}
