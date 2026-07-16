import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Point — 화면 주석 도구";
const description =
  "펜, 형광펜, 레이저 포인터를 빠르게 전환하는 컴팩트한 화면 주석 도구입니다.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const imageUrl = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: {
      type: "website",
      locale: "ko_KR",
      url: origin,
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 1536,
          height: 1024,
          alt: "Point 화면 주석 도구",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
