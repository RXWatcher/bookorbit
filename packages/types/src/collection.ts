import type { DashboardCatalogItem } from "./dashboard";
import type { WarehouseMediaType } from "./warehouse";

export type Collection = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  syncToKobo: boolean;
  displayOrder: number;
  bookCount: number;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CollectionCatalogItemRef = {
  mediaType: WarehouseMediaType;
  remoteId: string;
};

export type CollectionCatalogItemsPage = {
  items: DashboardCatalogItem[];
  total: number;
  page: number;
  size: number;
};

export type CollectionSummary = {
  id: number;
  name: string;
  bookCount: number;
};
