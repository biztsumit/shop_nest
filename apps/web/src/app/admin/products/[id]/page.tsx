import { Suspense } from "react";
import { ProductEditor } from "./product-editor";

export default function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-subtle" />}>
      <FromParams params={params} />
    </Suspense>
  );
}

async function FromParams({ params }: Pick<PageProps<"/admin/products/[id]">, "params">) {
  return <ProductEditor id={(await params).id} />;
}
