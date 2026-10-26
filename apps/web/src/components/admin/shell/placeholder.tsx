"use client";

import type { AdminArea } from "@open-lms/types";
import { EmptyState } from "@open-lms/ui";
import { AdminPage } from "./admin-page";
import { AreaGate } from "./area-gate";

/** A stand-in for an area whose pages are not built yet (replaced by the area's own page.tsx). */
export function AreaPlaceholder({ area, title, description }: { area: AdminArea; title: string; description: string }) {
  return (
    <AreaGate area={area}>
      <AdminPage title={title} description={description} testId={`admin-${area}-placeholder`}>
        <EmptyState compact title="This area is on its way" description="It opens here once it is ready." />
      </AdminPage>
    </AreaGate>
  );
}
