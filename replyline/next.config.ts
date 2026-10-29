import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      // The hosted enquiry form is the only page meant to be framed by customer websites.
      { source: "/((?!f/).*)", headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }] },
      { source: "/f/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
