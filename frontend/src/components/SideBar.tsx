import type { ReactNode } from "react";

export default function SideBar({ open }: { open: boolean }) {
  return (
    <div
      className={`min-w-64 w-[20%] gap-3 h-full m-0 bg-[#232526] text-gray-200 p-6 pt-12 fixed top-0 ${open ? "right-0" : "right-[min(-20%,calc(var(--spacing)*(-72)))]"} z-99 transition-all duration-300 ease-in-out shadow-[-10px_0px_15px_-3px_rgba(0,0,0,0.1)] flex flex-col items-center justify-between`}
    >
      <div className="flex justify-between flex-col w-full gap-3">
        <h2 className="text-center mt-[5vh] text-lg font-semibold uppercase tracking-[0.26em] text-white/78">
          Telemetry
        </h2>
      </div>
      <SideBarTile className="h-full">
        <div className="h-full w-full flex justify-center items-center text-center">
          <h3 className="text-white/55">Nothing to see here</h3>
        </div>
      </SideBarTile>
    </div>
  );
}

function SideBarTile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex w-full flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,#242424,#252525)] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.24)] ${className}`}
    >
      {children}
    </section>
  );
}
