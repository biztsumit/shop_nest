import { Suspense } from "react";
import { AdminOrderView } from "./admin-order-view";

export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[number]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-subtle" />}>
      <FromParams params={params} />
    </Suspense>
  );
}

async function FromParams({ params }: Pick<PageProps<"/admin/orders/[number]">, "params">) {
  return <AdminOrderView number={(await params).number} />;
}
