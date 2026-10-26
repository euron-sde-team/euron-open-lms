/** The admin shell pieces every /admin page builds on. Keep these props stable. */
export { AdminPage, AdminSection, type AdminPageProps } from "./admin-page";
export { DataTable, pagedTable, nextSort, sortRows, type Column, type DataTableProps, type SortState, type SortDir } from "./data-table";
export { FilterBar, SearchInput, type FilterBarProps } from "./filter-bar";
export { DetailSheet, DetailSection, FactList, type DetailSheetProps } from "./detail-sheet";
export { StatLine, type StatItem } from "./stat-line";
export { Chart, niceTicks, scaleLinear, indexAt, labelIndexes, formatDay, formatTick, type ChartProps, type ChartSeries, type ChartTone } from "./chart";
export { ReasonDialog, type ReasonDialogProps } from "./reason-dialog";
export { ForbiddenArea } from "./forbidden";
export { useAdminSession, useAdminSessionQuery, AdminSessionProvider, toViewer, type AdminViewer } from "./session";
export { useUrlState } from "./url-state";
export { ADMIN_NAV, visibleNav, activeNavHref, areaForPath, consoleTitle, type AdminNavGroup, type AdminNavItem } from "./nav";
export { AreaGate } from "./area-gate";
export { AreaPlaceholder } from "./placeholder";
