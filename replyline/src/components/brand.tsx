import Link from "next/link";
import { BRAND } from "@/config/brand";

export function Logo({ href = "/", inverted = false }: { href?: string; inverted?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label={`${BRAND.name} home`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="8" fill="#0d9488" />
        <path d="M8 10.5h8.5a3.5 3.5 0 0 1 0 7H12l-3 3v-3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19.5" cy="9" r="2" fill="#99f6e4" />
      </svg>
      <span className={`text-[17px] font-semibold tracking-tight ${inverted ? "text-white" : "text-ink-950"}`}>{BRAND.name}</span>
    </Link>
  );
}
