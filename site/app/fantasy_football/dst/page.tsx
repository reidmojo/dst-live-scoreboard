import type { Metadata } from "next";
import { headers } from "next/headers";
import DstTracker from "./dst-tracker";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "r31d.wiki";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const imageUrl = new URL("/dst-og-sleeper.png", `${protocol}://${host}`);
  return {
    title: "DST Tracker | r31d.wiki",
    description: "Live custom drive-scoring matchups for Is It Whiskey.",
    openGraph: {
      title: "Is It Whiskey · DST Drive Scoring",
      description: "Live custom drive-scoring matchups and finalized weekly results.",
      images: [{ url: imageUrl, width: 1731, height: 909, alt: "Is It Whiskey DST drive scoring" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Is It Whiskey · DST Drive Scoring",
      description: "Live custom drive-scoring matchups and finalized weekly results.",
      images: [imageUrl],
    },
  };
}

export default function DstTrackerPage() {
  return <DstTracker />;
}
