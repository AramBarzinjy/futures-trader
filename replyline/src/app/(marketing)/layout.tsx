import Link from "next/link";
import { Logo } from "@/components/brand";
import { ButtonLink } from "@/components/ui";
import { BRAND } from "@/config/brand";
import { INDUSTRIES, INDUSTRY_KEYS } from "@/config/industries";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-ink-600 md:flex">
            <Link href="/features" className="hover:text-ink-950">Features</Link>
            <Link href="/industries/trades" className="hover:text-ink-950">Who it&apos;s for</Link>
            <Link href="/pricing" className="hover:text-ink-950">Pricing</Link>
            <Link href="/faq" className="hover:text-ink-950">FAQ</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ButtonLink href="/sign-in" variant="ghost" size="sm">Sign in</ButtonLink>
            <ButtonLink href="/sign-up" size="sm">Start free trial</ButtonLink>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-4 sm:px-6">
          <div className="sm:col-span-1">
            <Logo />
            <p className="mt-3 text-sm text-ink-500">{BRAND.tagline}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Product</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li><Link href="/features">Features</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
              <li><Link href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Industries</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              {INDUSTRY_KEYS.map((k) => (
                <li key={k}><Link href={`/industries/${k}`}>{INDUSTRIES[k].label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Legal</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li><Link href="/legal/privacy">Privacy policy</Link></li>
              <li><Link href="/legal/terms">Terms of service</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-ink-100 py-5 text-center text-xs text-ink-400">© {new Date().getFullYear()} {BRAND.name}. Prices exclude VAT.</div>
      </footer>
    </div>
  );
}
