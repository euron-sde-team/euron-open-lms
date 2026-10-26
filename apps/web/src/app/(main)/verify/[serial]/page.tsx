import type { Metadata } from "next";
import type { Certificate } from "@open-lms/types";
import { CertificateView } from "@/components/verify/verify";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ serial: string }> };

const load = (serial: string) => serverGet<Certificate>(`/certificates/${encodeURIComponent(serial)}`, 60);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { serial } = await params;
  const c = await load(serial);
  // Certificates name a person: never in search results.
  const robots = { index: false, follow: false };
  if (!c) return { title: "Certificate", robots };
  return {
    title: c.revoked ? `Revoked certificate ${c.serial}` : `${c.courseTitle}: certificate`,
    description: c.revoked ? `This certificate from ${c.academyName} was revoked.` : `${c.learnerName} completed ${c.courseTitle} at ${c.academyName}.`,
    robots,
  };
}

export default async function Page({ params }: Props) {
  const { serial } = await params;
  return <CertificateView serial={serial} initial={await load(serial)} />;
}
