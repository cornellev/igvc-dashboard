import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import logo from "/logo.svg";
import socket from "./data";
import type { SocketData } from "./types";
import Autonomy from "./panels/Autonomy";
import Localization from "./panels/Localization";
import Perception from "./panels/Perception";
import { formatLatencySuffix } from "./Diagnostics";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#242424",
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          "&.MuiChartsTooltip-paper": {
            backgroundColor: "#1e1e1e",
            borderRadius: "8px",
            border: "1px solid #555",
            backgroundImage: "none",
          },
        },
      },
    },
  },
});

function DashboardCard({
  title,
  currentValue = "0.0 mph",
  className = "",
  children,
}: {
  title?: string;
  className?: string;
  currentValue?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,#242424,#252525)] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.24)] ${className}`}
    >
      {title ? (
        <div className="mb-2 flex items-center justify-between text-left">
          <h2 className="text-sm font-semibold uppercase tracking-[0.26em] text-white/78">
            {title}
          </h2>
          <div className="pointer-events-none absolute right-3 top-1 z-10 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium text-white/88">
            {currentValue}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-100 bg-linear-to-r from-[#232526] to-[#252628] shadow-[0_18px_40px_rgba(0,0,0,0.24)] border-b-white/8">
      <div className="max-w-9xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="Race Engineer Dashboard"
            className="w-8 h-8 sm:w-10 sm:h-10"
          />
          <span className="text-lg font-bold text-white sm:text-xl">
            Race Engineer Dashboard
          </span>
        </div>
      </div>
    </header>
  );
}

const HISTORY_LIMIT = 1200;

export default function App() {
  const [data, setData] = useState<SocketData[]>(() => socket.getData());
  const [isChartPaused, setIsChartPaused] = useState(false);
  const [pausedHistory, setPausedHistory] = useState<SocketData[]>([]);
  const history = useMemo(() => {
    if (isChartPaused) return pausedHistory;
    return data.slice(-HISTORY_LIMIT);
  }, [data, isChartPaused, pausedHistory]);
  const latest = history[history.length - 1] ?? null;
  const handlePauseChart = () => {
    setPausedHistory(data.slice(-HISTORY_LIMIT));
    setIsChartPaused(true);
  };
  const handleResumeChart = () => {
    setIsChartPaused(false);
  };
  useEffect(() => {
    socket.connect();
    const unsubscribe = socket.subscribe(() => {
      setData([...socket.getData()]);
    });
    return () => unsubscribe();
  }, []);
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Header />
      <div className="w-screen min-h-16.75 h-[7.5vh] max-h-19 mx-auto px-4 sm:px-6 lg:px-8" />
      <main className="w-screen h-fit transition-all duration-300 ease-in-out m-0 p-0">
        <section className="h-[min(92.5vh,calc(100vh-67px))] w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <Autonomy data={data} history={history}>
            {(autonomy) => (
              <Localization
                history={history}
                isChartPaused={isChartPaused}
                onTogglePause={
                  isChartPaused ? handleResumeChart : handlePauseChart
                }
              >
                {(localization) => (
                  <div className="grid min-h-full w-full grid-cols-1 gap-3 px-3 pt-2 pb-3.5 text-white sm:px-4 lg:grid-cols-12 lg:grid-rows-[minmax(100,1fr)_minmax(100,1fr)] lg:px-5">
                    <DashboardCard
                      className="min-h-42.5 auto-rows-fr lg:col-span-3 lg:row-start-1 lg:min-h-100"
                      title="Speed"
                    >
                      {autonomy.speed}
                    </DashboardCard>
                    <DashboardCard
                      className="min-h-42.5 lg:col-span-5 lg:row-start-1 lg:min-h-100"
                      title={`Run Summary${formatLatencySuffix(latest)}`}
                    >
                      {autonomy.summary}
                    </DashboardCard>
                    <DashboardCard className="min-h-200 lg:col-span-4 lg:row-start-1 lg:row-span-2 lg:min-h-100">
                      {localization.map}
                    </DashboardCard>
                    <DashboardCard
                      className="min-h-100 lg:col-span-4 lg:row-start-2 lg:min-h-55 2xl:col-span-5"
                      title="Power & Speed"
                    >
                      {localization.chart}
                    </DashboardCard>
                    <DashboardCard
                      className="min-h-100 lg:col-span-4 lg:row-start-2 lg:min-h-55 2xl:col-span-3"
                      title="Signals"
                    >
                      {autonomy.signals}
                    </DashboardCard>
                    <DashboardCard
                      className="min-h-60 lg:col-span-6 lg:min-h-72"
                      title="Camera (Left)"
                    >
                      <Perception side="left" />
                    </DashboardCard>
                    <DashboardCard
                      className="min-h-60 lg:col-span-6 lg:min-h-72"
                      title="Camera (Right)"
                    >
                      <Perception side="right" />
                    </DashboardCard>
                  </div>
                )}
              </Localization>
            )}
          </Autonomy>
        </section>
      </main>
    </ThemeProvider>
  );
}
