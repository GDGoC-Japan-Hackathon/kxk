import type { Metadata } from "next";
import Script from "next/script";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://worldlens.local"),
  title: {
    default: "WORLD MONITOR",
    template: "%s | WorldLens",
  },
  description: "Dark tactical Cesium globe for live earthquake and satellite monitoring.",
  applicationName: "WorldLens",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Script src="/api/runtime-config/script" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
