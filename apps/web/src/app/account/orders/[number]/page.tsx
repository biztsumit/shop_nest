import { Suspense } from "react";
import { OrderView } from "./order-view";

export default function OrderPage({ params }: PageProps<"/account/orders/[number]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-subtle" />}>
      <OrderFromParams params={params} />
    </Suspense>
  );
}

async function OrderFromParams({ params }: Pick<PageProps<"/account/orders/[number]">, "params">) {
  const { number } = await params;
  return <OrderView number={number} />;
}
