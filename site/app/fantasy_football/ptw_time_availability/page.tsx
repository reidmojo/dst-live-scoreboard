import type { Metadata } from "next";
import PtwTimeAvailabilityApp from "../ptw-time-availability-app";

export const metadata: Metadata = {
  title: "PTW Draft Time Availability | r31d.wiki",
  description: "Choose the PTW fantasy football draft start times, all shown in Pacific Daylight Time (PDT).",
  openGraph: {
    title: "PTW Draft Time Availability | r31d.wiki",
    description: "Choose the PTW fantasy football draft start times, all shown in Pacific Daylight Time (PDT).",
    images: [],
  },
  twitter: {
    card: "summary",
    title: "PTW Draft Time Availability | r31d.wiki",
    description: "Choose the PTW fantasy football draft start times, all shown in Pacific Daylight Time (PDT).",
    images: [],
  },
};

export default function PtwTimeAvailabilityPage() {
  return <PtwTimeAvailabilityApp />;
}
