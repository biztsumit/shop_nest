"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AdminHeader } from "./admin-shell";

// The dashboard (sales figures) arrives in step 7.2
export default function AdminHome() {
  return (
    <div>
      <AdminHeader title="Dashboard" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[["/admin/orders", "Orders to ship"], ["/admin/products", "Products"], ["/admin/coupons", "Coupons"]].map(([href, label]) => (
          <Link key={href} href={href!}><Card className="p-5 font-medium hover:border-brand">{label}</Card></Link>
        ))}
      </div>
    </div>
  );
}
