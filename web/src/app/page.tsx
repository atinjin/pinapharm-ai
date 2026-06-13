import { StoreProvider } from "@/components/store/StoreProvider";
import { Shell } from "@/components/store/Shell";

export default function Home() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
