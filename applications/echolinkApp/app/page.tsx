import { MicCapture } from "../components/micCapture";

export default function Home() {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-zinc-900 font-sans text-zinc-100">
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <MicCapture />
      </main>
    </div>
  );
}
