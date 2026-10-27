import type { ProductStatus } from "@shop/shared";
import type { BadgeTone } from "@/components/ui/badge";

// How each product status looks in the admin tables
export const STATUS_TONE: Record<ProductStatus, BadgeTone> = { ACTIVE: "success", DRAFT: "warning", ARCHIVED: "neutral" };
