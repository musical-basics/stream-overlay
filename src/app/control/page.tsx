import ControlPanel from "@/components/ControlPanel";

// Auth is enforced by middleware.ts before this page renders.
export default function ControlPage() {
  return <ControlPanel />;
}
